export const up = `
CREATE TABLE swarms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK (strategy IN ('adaptive','pipeline','star')),
  status TEXT NOT NULL CHECK (status IN ('active','completed','failed','cancelled')),
  max_agents INTEGER NOT NULL,
  session_id TEXT REFERENCES sessions(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_swarms_status ON swarms(status);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('main','worktree')),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  branch TEXT,
  created_at TEXT NOT NULL,
  removed_at TEXT
);
CREATE INDEX idx_workspaces_swarm ON workspaces(swarm_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','ready','claimed','running','blocked','review','completed','failed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  owner_agent TEXT,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  needs_worktree INTEGER NOT NULL DEFAULT 0,
  result_json TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX idx_tasks_swarm_status ON tasks(swarm_id, status);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id)
);
CREATE INDEX idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);

CREATE TABLE task_paths (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  PRIMARY KEY (task_id, pattern)
);

CREATE TABLE leases (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  holder_agent TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT
);
CREATE INDEX idx_leases_swarm_released ON leases(swarm_id, released_at);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('finding','question','answer','dependency','warning','result')),
  payload_json TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_swarm_to_read ON messages(swarm_id, to_agent, read_at);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL CHECK (namespace IN ('decisions','patterns','solutions','failures','tasks','feedback')),
  content TEXT NOT NULL,
  summary TEXT,
  source_swarm_id TEXT REFERENCES swarms(id) ON DELETE SET NULL,
  source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  vector_id INTEGER UNIQUE,
  content_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  archived_at TEXT
);
CREATE INDEX idx_memories_namespace_archived ON memories(namespace, archived_at);

CREATE VIRTUAL TABLE memories_fts USING fts5(
  content, summary,
  content='memories', content_rowid='rowid',
  tokenize="unicode61 tokenchars '_'"
);
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, summary) VALUES (new.rowid, new.content, new.summary);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, summary) VALUES ('delete', old.rowid, old.content, old.summary);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, summary) VALUES ('delete', old.rowid, old.content, old.summary);
  INSERT INTO memories_fts(rowid, content, summary) VALUES (new.rowid, new.content, new.summary);
END;

CREATE TABLE memory_feedback (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('helpful','wrong','stale')),
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_memory_feedback_memory ON memory_feedback(memory_id);
`;
