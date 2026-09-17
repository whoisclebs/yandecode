import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveInsideRoot, sha256, writeFileAtomic } from '@yandecode/core';
import type { ManagedFile } from './manifest.js';

export type MaterializeAction = 'created' | 'updated' | 'unchanged' | 'preserved';

export interface MaterializeResult {
  path: string;
  action: MaterializeAction;
  hash: string;
}

export function materializeFile(
  root: string,
  relPath: string,
  content: string,
  previous: ManagedFile | undefined,
  force: boolean,
): MaterializeResult {
  const abs = resolveInsideRoot(root, relPath);
  const newHash = sha256(content);
  if (existsSync(abs)) {
    const currentHash = sha256(readFileSync(abs));
    if (currentHash === newHash) return { path: relPath, action: 'unchanged', hash: newHash };
    const userEdited = previous === undefined || currentHash !== previous.hash;
    if (userEdited && !force) return { path: relPath, action: 'preserved', hash: currentHash };
    writeFileAtomic(abs, content);
    return { path: relPath, action: 'updated', hash: newHash };
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileAtomic(abs, content);
  return { path: relPath, action: 'created', hash: newHash };
}
