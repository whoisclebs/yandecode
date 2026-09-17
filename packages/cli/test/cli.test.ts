import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli.js';
import { VERSION } from '../src/version.js';

describe('cli program', () => {
  it('is named yandecode and reports the package version', () => {
    const program = buildProgram();
    expect(program.name()).toBe('yandecode');
    expect(program.version()).toBe(VERSION);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
