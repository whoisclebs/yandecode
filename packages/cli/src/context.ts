import { join } from 'node:path';
import {
  EventLog,
  EventRepository,
  IndexRepository,
  SessionRepository,
  StateService,
  YandeCodeError,
  ensureWorkspaceDirs,
  loadConfig,
  resolveWorkspace,
  type WorkspacePaths,
  type YandeCodeConfig,
} from '@yandecode/core';

export interface RuntimeContext {
  paths: WorkspacePaths;
  config: YandeCodeConfig;
  state: StateService;
  events: EventLog;
  sessions: SessionRepository;
  index: IndexRepository;
  close(): void;
}

export function openRuntime(cwd: string): RuntimeContext {
  const paths = resolveWorkspace(cwd);
  if (!paths) {
    throw new YandeCodeError(
      'WORKSPACE_NOT_INITIALIZED',
      `no yandecode.json found above ${cwd}; run "yandecode init"`,
    );
  }
  ensureWorkspaceDirs(paths);
  const config = loadConfig(paths.root);
  const state = StateService.open(paths.stateDb);
  return {
    paths,
    config,
    state,
    events: new EventLog(new EventRepository(state), join(paths.logsDir, 'events.jsonl')),
    sessions: new SessionRepository(state),
    index: new IndexRepository(state),
    close: () => state.close(),
  };
}

export function tryOpenRuntime(cwd: string): RuntimeContext | null {
  try {
    return openRuntime(cwd);
  } catch (error) {
    if (error instanceof YandeCodeError && error.code === 'WORKSPACE_NOT_INITIALIZED') return null;
    throw error;
  }
}
