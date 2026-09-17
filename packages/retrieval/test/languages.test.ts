import { describe, expect, it } from 'vitest';
import { GRAMMAR_FILES, detectLanguage } from '../src/chunking/languages.js';

describe('detectLanguage', () => {
  it('maps extensions and special filenames', () => {
    expect(detectLanguage('src/a.ts')).toBe('typescript');
    expect(detectLanguage('src/a.tsx')).toBe('tsx');
    expect(detectLanguage('lib/b.mjs')).toBe('javascript');
    expect(detectLanguage('x.py')).toBe('python');
    expect(detectLanguage('main.go')).toBe('go');
    expect(detectLanguage('A.java')).toBe('java');
    expect(detectLanguage('lib.rs')).toBe('rust');
    expect(detectLanguage('README.md')).toBe('markdown');
    expect(detectLanguage('config.yml')).toBe('yaml');
    expect(detectLanguage('Dockerfile')).toBe('text');
    expect(detectLanguage('photo.PNG')).toBeNull();
  });
  it('has a grammar for each tree-sitter language', () => {
    expect(Object.keys(GRAMMAR_FILES).sort()).toEqual(['go', 'java', 'javascript', 'python', 'rust', 'tsx', 'typescript']);
  });
});
