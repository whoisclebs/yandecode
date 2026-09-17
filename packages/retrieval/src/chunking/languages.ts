import { basename, extname } from 'node:path';

const BY_EXT: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  py: 'python', go: 'go', java: 'java', rs: 'rust',
  md: 'markdown', mdx: 'markdown', json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml',
  sh: 'shell', bash: 'shell', css: 'css', scss: 'css', html: 'html', sql: 'sql', txt: 'text',
};
const BY_NAME: Record<string, string> = { Dockerfile: 'text', Makefile: 'text' };

export function detectLanguage(path: string): string | null {
  const name = basename(path);
  if (BY_NAME[name]) return BY_NAME[name];
  const ext = extname(name).slice(1).toLowerCase();
  return BY_EXT[ext] ?? null;
}

export const GRAMMAR_FILES: Record<string, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  java: 'tree-sitter-java.wasm',
  rust: 'tree-sitter-rust.wasm',
};
