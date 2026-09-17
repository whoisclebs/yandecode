import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { detectLanguage } from '../chunking/languages.js';
import { buildIgnore, DEFAULT_IGNORED_DIRS, isProbablyBinary, MAX_FILE_BYTES } from './rules.js';

export interface ScannedFile {
  relPath: string;
  absPath: string;
  sizeBytes: number;
  contentHash: string;
  language: string | null;
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(`..${sep}`);
}

function isGitRepo(root: string): boolean {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: root,
    encoding: 'utf8',
  });
  return r.status === 0 && r.stdout.trim() === 'true';
}

function listViaGit(root: string): string[] {
  const r = spawnSync(
    'git',
    ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return r.stdout
    .split('\0')
    .filter((p) => p.length > 0)
    .map(toPosix);
}

function listViaWalk(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if ((DEFAULT_IGNORED_DIRS as readonly string[]).includes(entry.name)) continue;
        stack.push(join(dir, entry.name));
        continue;
      }
      out.push(toPosix(relative(root, join(dir, entry.name))));
    }
  }
  return out;
}

function readHead(absPath: string, n: number): Buffer {
  const fd = openSync(absPath, 'r');
  try {
    const buf = Buffer.alloc(n);
    const bytesRead = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

export function listFiles(root: string): string[] {
  const raw = isGitRepo(root) ? listViaGit(root) : listViaWalk(root);
  const ig = buildIgnore(root);
  const kept: string[] = [];
  for (const relPath of ig.filter(raw)) {
    const absPath = join(root, relPath);
    const lst = lstatSync(absPath, { throwIfNoEntry: false });
    if (!lst) continue;
    if (lst.isSymbolicLink()) {
      let real: string;
      try {
        real = realpathSync(absPath);
      } catch {
        continue;
      }
      if (!isInsideRoot(root, real)) continue;
    }
    const st = statSync(absPath, { throwIfNoEntry: false });
    if (!st || !st.isFile()) continue;
    if (st.size > MAX_FILE_BYTES) continue;
    if (isProbablyBinary(readHead(absPath, 8192))) continue;
    kept.push(relPath);
  }
  return kept;
}

export function scanRepository(root: string): Promise<ScannedFile[]> {
  return Promise.resolve(
    listFiles(root).map((relPath) => {
      const absPath = join(root, relPath);
      const content = readFileSync(absPath);
      return {
        relPath,
        absPath,
        sizeBytes: content.byteLength,
        contentHash: createHash('sha256').update(content).digest('hex'),
        language: detectLanguage(relPath),
      };
    }),
  );
}

export interface ExistingDoc {
  path: string;
  contentHash: string;
}

export interface DiffResult {
  added: ScannedFile[];
  changed: ScannedFile[];
  removed: string[];
  unchanged: number;
}

export function diffScan(scanned: ScannedFile[], existing: ExistingDoc[]): DiffResult {
  const byPath = new Map(existing.map((e) => [e.path, e.contentHash]));
  const seen = new Set<string>();
  const added: ScannedFile[] = [];
  const changed: ScannedFile[] = [];
  let unchanged = 0;
  for (const file of scanned) {
    seen.add(file.relPath);
    const prevHash = byPath.get(file.relPath);
    if (prevHash === undefined) added.push(file);
    else if (prevHash !== file.contentHash) changed.push(file);
    else unchanged += 1;
  }
  const removed = existing.filter((e) => !seen.has(e.path)).map((e) => e.path);
  return { added, changed, removed, unchanged };
}
