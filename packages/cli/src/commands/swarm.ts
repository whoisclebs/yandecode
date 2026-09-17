import type { SwarmRecord, TaskRecord, TaskStatus } from '@yandecode/core';
import { registerCommand } from '../cli.js';
import { openRuntime } from '../context.js';
import { createSwarmRuntime } from '../swarm-runtime.js';

export function formatSwarmList(swarms: SwarmRecord[]): string {
  if (swarms.length === 0) return 'No active swarms.\n';
  return `${swarms.map((s) => `${s.id}  ${s.title}  [${s.strategy}]`).join('\n')}\n`;
}

export function formatSwarmDetail(swarm: SwarmRecord, tasks: TaskRecord[]): string {
  const counts = new Map<TaskStatus, number>();
  for (const t of tasks) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
  const lines = [`${swarm.id}  ${swarm.title}  [${swarm.strategy}]  status=${swarm.status}`, `Goal: ${swarm.goal}`, `Tasks (${tasks.length}):`];
  for (const [status, count] of counts) lines.push(`  ${status}: ${count}`);
  return `${lines.join('\n')}\n`;
}

registerCommand((program) => {
  const swarm = program.command('swarm').description('Swarm orchestration commands');
  swarm
    .command('status [swarmId]')
    .description("Show all active swarms, or one swarm's task breakdown")
    .action((swarmId?: string) => {
      const rt = openRuntime(process.cwd());
      const { swarmService } = createSwarmRuntime(rt);
      try {
        if (!swarmId) {
          process.stdout.write(formatSwarmList(swarmService.listActiveSwarms()));
          return;
        }
        const record = swarmService.getSwarm(swarmId);
        if (!record) {
          process.stderr.write(`No such swarm: ${swarmId}\n`);
          process.exitCode = 1;
          return;
        }
        process.stdout.write(formatSwarmDetail(record, swarmService.taskList(swarmId)));
      } finally {
        rt.close();
      }
    });
});
