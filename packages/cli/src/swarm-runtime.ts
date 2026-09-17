import { LeaseRepository, MessageRepository, SwarmRepository, TaskRepository, WorkspaceRepository } from '@yandecode/core';
import { SwarmService } from '@yandecode/swarm';
import type { RuntimeContext } from './context.js';

export interface SwarmRuntime {
  swarmService: SwarmService;
  messages: MessageRepository;
}

export function createSwarmRuntime(rt: RuntimeContext): SwarmRuntime {
  const swarmService = new SwarmService({
    swarms: new SwarmRepository(rt.state),
    tasks: new TaskRepository(rt.state),
    leases: new LeaseRepository(rt.state),
    workspaces: new WorkspaceRepository(rt.state),
  });
  return { swarmService, messages: new MessageRepository(rt.state) };
}
