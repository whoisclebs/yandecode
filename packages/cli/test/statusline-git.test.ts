import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gatherGitInfo } from '../src/status-line/git.js';

let dir: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yc-statusline-git-'));
  git(['init', '--initial-branch=main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('gatherGitInfo', () => {
  it('returns null when the directory is not a git repository', () => {
    const bare = mkdtempSync(join(tmpdir(), 'yc-statusline-nogit-'));
    try {
      expect(gatherGitInfo(bare)).toBeNull();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('reports the current branch and a clean tree after a commit', () => {
    writeFileSync(join(dir, 'a.txt'), 'hello');
    git(['add', 'a.txt']);
    git(['commit', '-m', 'initial']);
    const info = gatherGitInfo(dir);
    expect(info?.branch).toBe('main');
    expect(info?.dirty).toBe(false);
    expect(info?.ahead).toBe(0);
    expect(info?.behind).toBe(0);
  });

  it('reports a dirty tree when there are uncommitted changes', () => {
    writeFileSync(join(dir, 'a.txt'), 'hello');
    git(['add', 'a.txt']);
    git(['commit', '-m', 'initial']);
    writeFileSync(join(dir, 'a.txt'), 'changed');
    const info = gatherGitInfo(dir);
    expect(info?.dirty).toBe(true);
  });
});
