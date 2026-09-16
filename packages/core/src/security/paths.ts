import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { YandeCodeError } from '../errors.js';

function deepestExisting(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`));
}

export function resolveInsideRoot(root: string, target: string): string {
  const absRoot = realpathSync(resolve(root));
  const absTarget = resolve(absRoot, target);
  if (!isInside(absRoot, absTarget)) {
    throw new YandeCodeError('PATH_OUTSIDE_ROOT', `${target} resolves outside ${root}`);
  }
  const existing = deepestExisting(absTarget);
  const realExisting = realpathSync(existing);
  if (!isInside(absRoot, realExisting)) {
    throw new YandeCodeError('PATH_OUTSIDE_ROOT', `${target} links outside ${root}`);
  }
  return absTarget;
}
