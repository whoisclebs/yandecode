#!/usr/bin/env node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntime } from '../packages/cli/dist/context.js';
import { createSwarmRuntime } from '../packages/cli/dist/swarm-runtime.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`ok: ${message}`);
}

const dir = mkdtempSync(join(tmpdir(), 'yc-smoke-'));
process.env.YANDECODE_EMBEDDINGS = 'hash';
try {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dir, 'yandecode.json'), '{}');
  const rt = openRuntime(dir);
  const { swarmService, memoryService, memoryRetriever } = await createSwarmRuntime(rt);

  const swarm = await swarmService.createSwarm({
    title: 'Smoke test',
    goal: 'Prove the swarm+memory loop works headlessly',
    strategy: 'adaptive',
    sessionId: null,
  });
  assert(swarm.status === 'active', 'swarm created and active');

  const [a, b] = await swarmService.taskCreate(swarm.id, [
    {
      ref: 'a',
      title: 'Implement',
      description: 'Implement the thing',
      role: 'implementer',
      paths: ['src/a/**'],
    },
    { ref: 'b', title: 'Test it', description: 'Write tests', role: 'tester', dependsOn: ['a'] },
  ]);
  assert(a.status === 'planned' && b.status === 'planned', 'both tasks created as planned');

  await swarmService.taskUpdate(a.id, 'ready');
  const batch1 = await swarmService.swarmNext(swarm.id);
  assert(
    batch1.length === 1 && batch1[0].taskId === a.id,
    'swarmNext offers only the unblocked task a',
  );

  // swarmNext already transitioned task a to 'claimed' as part of offering it above
  // (see SwarmService.swarmNext, and packages/swarm/test/swarm-service.test.ts's
  // "claims ready tasks atomically" case) — claimed -> claimed is not a valid
  // transition (packages/core/src/persistence/repositories/tasks.ts), so we do not
  // re-claim here.
  const reserve = await swarmService.workspaceReserve({
    swarmId: swarm.id,
    taskId: a.id,
    patterns: ['src/a/**'],
    holderAgent: a.id,
  });
  assert(reserve.granted === true, 'workspace reservation granted for an uncontested pattern');
  await swarmService.taskUpdate(a.id, 'running', { ownerAgent: a.id });
  await swarmService.taskUpdate(a.id, 'completed', { resultJson: '{"ok":true}' });
  await swarmService.workspaceRelease(a.id);

  const batch2 = await swarmService.swarmNext(swarm.id);
  assert(
    batch2.some((s) => s.taskId === b.id),
    'completing a unblocks its dependent task b',
  );

  const stored = await memoryService.store({
    namespace: 'patterns',
    content: 'Smoke test proved the swarm+memory MCP-free path works end to end.',
    summary: 'Smoke test success',
    sourceSwarmId: swarm.id,
    sourceTaskId: a.id,
    confidence: 0.9,
    evidence: a.id,
  });
  assert(stored.status === 'stored', 'memory stored successfully with evidence');

  const hits = await memoryRetriever.search('swarm memory end to end', { namespace: 'patterns' });
  assert(
    hits.some((h) => h.id === stored.memory.id),
    'the stored memory is retrievable by search',
  );

  await swarmService.swarmCancel(swarm.id);
  const status = swarmService.getSwarm(swarm.id);
  assert(status.status === 'cancelled', 'swarmCancel terminates the swarm');

  rt.close();
  console.log('\nAll swarm+memory smoke checks passed.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
