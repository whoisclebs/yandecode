import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../src/security/atomic-write.js';
import { sha256 } from '../src/security/hash.js';
import { resolveInsideRoot } from '../src/security/paths.js';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'yc-sec-'));

describe('resolveInsideRoot', () => {
  it('accepts relative paths inside the root', () => {
    const root = tmp();
    expect(resolveInsideRoot(root, 'src/a.ts')).toBe(join(root, 'src', 'a.ts'));
  });

  it('rejects traversal outside the root', () => {
    const root = tmp();
    expect(() => resolveInsideRoot(root, '../escape.txt')).toThrow(/PATH_OUTSIDE_ROOT/);
    expect(() => resolveInsideRoot(root, '/etc/passwd')).toThrow(/PATH_OUTSIDE_ROOT/);
  });

  it('rejects symlinks that point outside the root', () => {
    const root = tmp();
    const outside = tmp();
    writeFileSync(join(outside, 'secret'), 'x');
    symlinkSync(join(outside, 'secret'), join(root, 'link'));
    expect(() => resolveInsideRoot(root, 'link')).toThrow(/PATH_OUTSIDE_ROOT/);
  });

  it('accepts a not-yet-existing file under an existing directory', () => {
    const root = tmp();
    mkdirSync(join(root, 'dir'));
    expect(resolveInsideRoot(root, 'dir/new.txt')).toBe(join(root, 'dir', 'new.txt'));
  });
});

describe('writeFileAtomic', () => {
  it('writes content and leaves no temp files behind', () => {
    const root = tmp();
    const file = join(root, 'out.txt');
    writeFileAtomic(file, 'hello');
    writeFileAtomic(file, 'world');
    expect(readFileSync(file, 'utf8')).toBe('world');
    expect(readdirSync(root)).toEqual(['out.txt']);
    expect(existsSync(file)).toBe(true);
  });

  it('cleans up temp file on write failure', () => {
    const root = tmp();
    // Create a file at the target location to block writes
    const blockingFile = join(root, 'blocking');
    writeFileSync(blockingFile, 'x');
    // Try to write to a path where the parent is a file, not a directory
    const failingPath = join(blockingFile, 'nested.txt');
    expect(() => writeFileAtomic(failingPath, 'data')).toThrow();
    // Verify no .tmp files are left behind in the root
    const files = readdirSync(root);
    const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });
});

describe('sha256', () => {
  it('hashes strings and bytes identically', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256(new TextEncoder().encode('abc'))).toBe(sha256('abc'));
  });
});
