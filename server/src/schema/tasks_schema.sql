-- Embedded SQLite schema for tasks metadata.db
PRAGMA foreign_keys = ON;

CREATE TABLE
  IF NOT EXISTS metadata (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    targets TEXT NOT NULL,
    status INTEGER NOT NULL,
    exit_code INTEGER,
    error_message TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    started_at INTEGER,
    finished_at INTEGER,
    log_path TEXT
  );

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);