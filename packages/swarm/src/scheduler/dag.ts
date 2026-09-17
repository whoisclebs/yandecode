import { YandeCodeError } from '@yandecode/core';

export interface DagNode {
  id: string;
  dependsOn: string[];
}

export function validateAcyclic(nodes: DagNode[]): void {
  const graph = new Map(nodes.map((n) => [n.id, n.dependsOn]));
  const state = new Map<string, 'visiting' | 'done'>();

  function visit(id: string, path: string[]): void {
    const current = state.get(id);
    if (current === 'done') return;
    if (current === 'visiting') {
      throw new YandeCodeError(
        'CYCLIC_TASK_DEPENDENCY',
        `cycle detected: ${[...path, id].join(' -> ')}`,
      );
    }
    state.set(id, 'visiting');
    for (const dep of graph.get(id) ?? []) visit(dep, [...path, id]);
    state.set(id, 'done');
  }

  for (const node of nodes) visit(node.id, []);
}
