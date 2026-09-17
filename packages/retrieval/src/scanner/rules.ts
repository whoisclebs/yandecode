import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ignore, { type Ignore } from 'ignore';

export const DEFAULT_IGNORED_DIRS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'target',
  'vendor',
  '.next',
  '.cache',
  '.yandecode',
] as const;

export const SECRET_PATTERNS = ['.env', '.env.*', '*.pem', '*.key', 'id_rsa', 'id_ed25519', 'credentials.*', 'secrets.*'] as const;

export const MAX_FILE_BYTES = 512 * 1024;

export function isProbablyBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8192).includes(0);
}

export function buildIgnore(root: string): Ignore {
  const ig = ignore();
  ig.add(DEFAULT_IGNORED_DIRS.map((dir) => `${dir}/`));
  ig.add([...SECRET_PATTERNS]);
  const custom = join(root, '.yandecodeignore');
  if (existsSync(custom)) ig.add(readFileSync(custom, 'utf8'));
  return ig;
}
