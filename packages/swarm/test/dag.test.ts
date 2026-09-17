import { describe, expect, it } from 'vitest';
import { validateAcyclic } from '../src/scheduler/dag.js';

describe('validateAcyclic', () => {
  it('accepts a DAG with no cycles', () => {
    expect(() =>
      validateAcyclic([
        { id: 'a', dependsOn: [] },
        { id: 'b', dependsOn: ['a'] },
        { id: 'c', dependsOn: ['a', 'b'] },
      ]),
    ).not.toThrow();
  });

  it('rejects a direct two-node cycle', () => {
    expect(() =>
      validateAcyclic([
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] },
      ]),
    ).toThrow(/CYCLIC_TASK_DEPENDENCY/);
  });

  it('rejects a longer indirect cycle', () => {
    expect(() =>
      validateAcyclic([
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['c'] },
        { id: 'c', dependsOn: ['a'] },
      ]),
    ).toThrow(/CYCLIC_TASK_DEPENDENCY/);
  });

  it('accepts an empty node list and a single node with no dependencies', () => {
    expect(() => validateAcyclic([])).not.toThrow();
    expect(() => validateAcyclic([{ id: 'a', dependsOn: [] }])).not.toThrow();
  });
});
