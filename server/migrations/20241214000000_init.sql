CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    targets TEXT,
    status INTEGER NOT NULL,
    exit_code INTEGER,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER,
    started_at INTEGER,
    finished_at INTEGER,
    log_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
