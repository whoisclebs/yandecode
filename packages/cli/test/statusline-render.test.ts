import { describe, expect, it } from 'vitest';
import { renderStatusLine, type StatusLineInput } from '../src/status-line/render.js';

function baseInput(overrides: Partial<StatusLineInput> = {}): StatusLineInput {
  return {
    version: '0.1.0',
    projectName: 'yandecode',
    model: 'Sonnet 5',
    durationMs: 3000,
    git: { branch: 'main', dirty: false, ahead: 0, behind: 0 },
    workspace: {
      chunks: 42,
      dirtyFiles: 0,
      indexGeneration: 1,
      indexBytes: 25 * 1024 * 1024,
      hooksRegistered: 6,
      hooksTotal: 6,
      swarm: { done: 1, total: 15 },
    },
    ...overrides,
  };
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9]*m/g, '');
}

describe('renderStatusLine', () => {
  it('renders three lines with project, git, model, swarm, hooks, chunks, size, and scan status', () => {
    const out = stripAnsi(renderStatusLine(baseInput()));
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('YandeCode v0.1.0');
    expect(lines[0]).toContain('yandecode');
    expect(lines[0]).toContain('main');
    expect(lines[0]).toContain('Sonnet 5');
    expect(lines[0]).toContain('3s');
    expect(lines[1]).toContain('Swarm');
    expect(lines[1]).toContain('1/15');
    expect(lines[1]).toContain('Hooks 6/6');
    expect(lines[1]).toContain('42 chunks');
    expect(lines[1]).toContain('25MB');
    expect(lines[1]).toContain('scan clean');
  });

  it('shows a dirty marker and ahead/behind counts when the git tree has drifted', () => {
    const out = stripAnsi(
      renderStatusLine(baseInput({ git: { branch: 'feature', dirty: true, ahead: 2, behind: 1 } })),
    );
    expect(out).toContain('feature*');
    expect(out).toContain('+2');
    expect(out).toContain('-1');
  });

  it('shows scan pending with the dirty file count when files are queued for reindex', () => {
    const out = stripAnsi(
      renderStatusLine(
        baseInput({
          workspace: {
            chunks: 42,
            dirtyFiles: 3,
            indexGeneration: 1,
            indexBytes: 1024,
            hooksRegistered: 6,
            hooksTotal: 6,
            swarm: null,
          },
        }),
      ),
    );
    expect(out).toContain('scan pending (3)');
    expect(out).toContain('Swarm ○ idle');
  });

  it('shows "not indexed" when the repository has zero chunks', () => {
    const out = stripAnsi(
      renderStatusLine(
        baseInput({
          workspace: {
            chunks: 0,
            dirtyFiles: 0,
            indexGeneration: 0,
            indexBytes: 0,
            hooksRegistered: 6,
            hooksTotal: 6,
            swarm: null,
          },
        }),
      ),
    );
    expect(out).toContain('not indexed');
  });

  it('falls back to a single-line message when no YandeCode workspace is initialized', () => {
    const out = stripAnsi(renderStatusLine(baseInput({ workspace: null })));
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('not initialized');
    expect(lines[1]).toContain('yandecode init');
  });

  it('omits the git and model segments when they are unavailable', () => {
    const out = stripAnsi(
      renderStatusLine(baseInput({ git: null, model: null, durationMs: null })),
    );
    const lines = out.split('\n');
    expect(lines[0]).not.toContain('|  |');
    expect(lines[0]).toContain('yandecode');
  });
});
