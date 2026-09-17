import { existsSync, readFileSync } from 'node:fs';

/**
 * Reads and parses a JSON file, returning `fallback` if the file does not
 * exist, cannot be read, or contains malformed JSON. Never throws.
 */
export function readJsonSafe<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/**
 * True if `file` exists but its contents are not valid JSON. Used where a
 * caller needs to distinguish "missing" (fine, treat as absent) from
 * "present but corrupt" (worth surfacing to the user) rather than silently
 * falling back for both, as `readJsonSafe` does.
 */
export function isMalformedJson(file: string): boolean {
  if (!existsSync(file)) return false;
  try {
    JSON.parse(readFileSync(file, 'utf8'));
    return false;
  } catch {
    return true;
  }
}
