import { describe, expect, it } from 'vitest';
import { launcherCommandLine, resolveLauncher } from '../src/launcher.js';

describe('resolveLauncher', () => {
  it('prefers a global yandecode binary', () => {
    expect(resolveLauncher(() => true)).toEqual({ command: 'yandecode', args: [] });
  });
  it('falls back to npx when yandecode is not on PATH', () => {
    expect(resolveLauncher(() => false)).toEqual({ command: 'npx', args: ['yandecode'] });
  });
  it('renders a command line', () => {
    expect(launcherCommandLine({ command: 'npx', args: ['yandecode'] }, 'hook', 'SessionStart')).toBe('npx yandecode hook SessionStart');
  });
});
