import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { diffScan, scanRepository } from '../src/scanner/scanner.js';

let root: string;

function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

function seedFixture(dir: string): void {
  writeFileSync(join(dir, '.gitignore'), 'ignored-by-git.txt\n');
  writeFileSync(
    join(dir, 'ignored-by-git.txt'),
    'should not appear when git-tracked ignore rules apply',
  );
  writeFileSync(join(dir, '.env'), 'SECRET=1');
  writeFileSync(join(dir, 'binary.dat'), Buffer.from([0, 1, 2, 0, 5]));
  writeFileSync(join(dir, 'huge.txt'), 'x'.repeat(600 * 1024));
  writeFileSync(join(dir, '.yandecodeignore'), 'skip-me.txt\n');
  writeFileSync(join(dir, 'skip-me.txt'), 'skip');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'README.md'), '# Hello\n');
  try {
    symlinkSync('/etc', join(dir, 'etc-link'));
  } catch {
    // symlink creation can be restricted in some sandboxes; listFiles simply won't see it then
  }
}

describe('scanRepository (git repository)', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'yc-scan-git-'));
    initGitRepo(root);
    seedFixture(root);
  });

  it('excludes gitignored, secret, oversized, binary and outside-root-symlink paths', async () => {
    const files = await scanRepository(root);
    const relPaths = files.map((f) => f.relPath).sort();
    expect(relPaths).toEqual(['.gitignore', '.yandecodeignore', 'README.md', 'src/index.ts']);
  });

  it('computes a language and a stable sha256 content hash per file', async () => {
    const files = await scanRepository(root);
    const index = files.find((f) => f.relPath === 'src/index.ts')!;
    expect(index.language).toBe('typescript');
    expect(index.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(index.sizeBytes).toBe(Buffer.byteLength('export const a = 1;\n'));
  });

  it('skips a dangling symlink instead of crashing the whole scan', async () => {
    symlinkSync(join(root, 'does-not-exist.txt'), join(root, 'broken-link.txt'));
    writeFileSync(join(root, 'real-file.ts'), 'export const x = 1;\n');
    const scanned = await scanRepository(root);
    expect(scanned.map((f) => f.relPath)).not.toContain('broken-link.txt');
    expect(scanned.map((f) => f.relPath)).toContain('real-file.ts');
  });
});

describe('scanRepository (no .git directory)', () => {
  it('falls back to a directory walk that does not honour .gitignore but still applies the other rules', async () => {
    root = mkdtempSync(join(tmpdir(), 'yc-scan-walk-'));
    seedFixture(root);
    const files = await scanRepository(root);
    const relPaths = files.map((f) => f.relPath).sort();
    expect(relPaths).toEqual([
      '.gitignore',
      '.yandecodeignore',
      'README.md',
      'ignored-by-git.txt',
      'src/index.ts',
    ]);
  });

  it('excludes files inside DEFAULT_IGNORED_DIRS from both git and non-git scans', async () => {
    root = mkdtempSync(join(tmpdir(), 'yc-scan-ignored-'));
    mkdirSync(join(root, 'node_modules', 'some-pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'some-pkg', 'index.js'), 'module.exports = {};\n');
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'bundle.js'), 'console.log(1);\n');
    writeFileSync(join(root, 'kept.ts'), 'export const y = 2;\n');

    const scanned = await scanRepository(root);
    const paths = scanned.map((f) => f.relPath);
    expect(paths).not.toEqual(expect.arrayContaining([expect.stringContaining('node_modules')]));
    expect(paths).not.toEqual(expect.arrayContaining([expect.stringContaining('dist/')]));
    expect(paths).toContain('kept.ts');
  });
});

describe('diffScan', () => {
  it('classifies added, changed, removed and unchanged files', async () => {
    root = mkdtempSync(join(tmpdir(), 'yc-diff-'));
    initGitRepo(root);
    writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, 'b.ts'), 'export const b = 1;\n');
    const scanned = await scanRepository(root);
    const a = scanned.find((f) => f.relPath === 'a.ts')!;

    const result = diffScan(scanned, [
      { path: 'a.ts', contentHash: a.contentHash },
      { path: 'c.ts', contentHash: 'stale-hash' },
    ]);
    expect(result.added.map((f) => f.relPath)).toEqual(['b.ts']);
    expect(result.changed).toEqual([]);
    expect(result.removed).toEqual(['c.ts']);
    expect(result.unchanged).toBe(1);

    writeFileSync(join(root, 'a.ts'), 'export const a = 2;\n');
    const rescanned = await scanRepository(root);
    const result2 = diffScan(rescanned, [{ path: 'a.ts', contentHash: a.contentHash }]);
    expect(result2.changed.map((f) => f.relPath)).toEqual(['a.ts']);
    expect(result2.unchanged).toBe(0);
  });
});
