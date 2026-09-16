export const up = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  claude_session_id TEXT,
  cwd TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT,
  compact_summary TEXT
);
CREATE INDEX idx_sessions_claude ON sessions(claude_session_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  event TEXT NOT NULL,
  agent TEXT,
  duration_ms INTEGER,
  data_json TEXT
);
CREATE INDEX idx_events_ts ON events(ts);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  language TEXT,
  size_bytes INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  git_commit TEXT,
  indexed_at TEXT NOT NULL,
  index_generation INTEGER NOT NULL
);
CREATE INDEX idx_documents_hash ON documents(content_hash);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  vector_id INTEGER NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  symbol TEXT,
  identifiers TEXT NOT NULL DEFAULT '',
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_chunks_document ON chunks(document_id);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content, symbol, identifiers,
  content='chunks', content_rowid='rowid',
  tokenize="unicode61 tokenchars '_'"
);
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, content, symbol, identifiers) VALUES (new.rowid, new.content, new.symbol, new.identifiers);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content, symbol, identifiers) VALUES ('delete', old.rowid, old.content, old.symbol, old.identifiers);
END;
CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content, symbol, identifiers) VALUES ('delete', old.rowid, old.content, old.symbol, old.identifiers);
  INSERT INTO chunks_fts(rowid, content, symbol, identifiers) VALUES (new.rowid, new.content, new.symbol, new.identifiers);
END;

CREATE TABLE vector_index_meta (
  name TEXT PRIMARY KEY CHECK (name IN ('repository','memory')),
  generation INTEGER NOT NULL,
  dimensions INTEGER NOT NULL,
  model_id TEXT NOT NULL,
  vector_count INTEGER NOT NULL,
  built_at TEXT NOT NULL,
  file_path TEXT NOT NULL
);

CREATE TABLE index_dirty (
  path TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  marked_at TEXT NOT NULL
);

CREATE TABLE vector_id_seq (
  name TEXT PRIMARY KEY CHECK (name IN ('repository','memory')),
  next_id INTEGER NOT NULL
);
INSERT INTO vector_id_seq (name, next_id) VALUES ('repository', 1), ('memory', 1);
`;
