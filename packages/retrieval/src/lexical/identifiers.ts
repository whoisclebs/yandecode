import { splitIdentifier } from '@yandecode/core';

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'import', 'export', 'from', 'class', 'this', 'new', 'if', 'else', 'for', 'while',
  'true', 'false', 'null', 'undefined', 'async', 'await', 'public', 'private', 'protected', 'static', 'void', 'string', 'number',
  'boolean', 'def', 'self', 'pub', 'mut', 'impl', 'struct', 'enum', 'use', 'package', 'func', 'type', 'interface', 'extends',
  'implements', 'default', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof',
]);
const MAX = 200;

export function identifiersOf(text: string): string {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string): void => {
    if (t.length < 3 || KEYWORDS.has(t) || seen.has(t) || out.length >= MAX) return;
    seen.add(t);
    out.push(t);
  };
  for (const id of text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    push(id.toLowerCase());
    const parts = splitIdentifier(id);
    if (parts.length > 1) for (const p of parts) push(p);
  }
  return out.join(' ');
}
