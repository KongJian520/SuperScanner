# Copilot instructions for SuperScanner

## Build, test, and lint commands

This repository is a Rust workspace with a Tauri + React client.

### Rust workspace (from repo root)

```powershell
cargo build --workspace
cargo test --workspace --exclude SuperScannerClient
```

Run a single Rust test:

```powershell
cargo test -p SuperScannerServer storage::task_db::tests::test_create_targets_db_single_ip
```

### Client frontend (`client/`)

```powershell
pnpm dev
pnpm build
```

### Tauri app (`client/src-tauri/` via workspace)

```powershell
cargo run -p SuperScannerClient
```

### Linting

There is no dedicated lint script in `client/package.json` and no repo-specific lint runner checked in.
Use ecosystem defaults when needed:

```powershell
cargo clippy --workspace --all-targets
```

## High-level architecture

SuperScanner is split into three layers:

1. `proto/` defines gRPC contracts (`tasks.v1`, `status.v1`).
2. `shared/` compiles and re-exports generated protobuf types plus shared enums/models (notably `TaskStatus`).
3. Runtime apps:
   - `server/`: gRPC server and task execution engine.
   - `client/src-tauri/`: Tauri bridge that speaks gRPC to servers and exposes Tauri `invoke` commands to the UI.
   - `client/`: React UI using TanStack Query + Zustand.

Core runtime flow:

1. UI calls Tauri commands (`invoke`) in `client/src/lib/api.ts` (not gRPC directly).
2. Tauri Rust command handlers call remote gRPC services through pooled channels in `AppState::channel_for`.
3. Server `TasksService` persists metadata and task files, then starts/stops work via `BackgroundTaskRunner`.
4. Worker executes command plugins from `CommandRegistry`, updates task progress/status, and writes per-task scan results into SQLite (`targets.db`).
5. Task events stream from server gRPC → Tauri `window.emit("task-event://<id>")` → React `useTaskEvents` updates query cache.

Persistence model:

- Global runtime root is `<SUPERSCANNER_HOMEDIR or default>/scanner-projects`.
- Per-task state is file-oriented under `tasks/<task_id>/` (`metadata.toml`, `workflow.json`, `commands/*/spec.toml`, `targets.db`).
- Scheduler state is persisted in `scheduler.db`.
- Client backend registry is persisted in OS config dir as `SuperScanner/backends.json`.

## Key conventions in this codebase

- Keep task status values aligned with proto enum values (`PENDING=1`, `RUNNING=2`, etc.); server/shared/client all rely on the same numeric mapping.
- New scanners follow the `ScannerCommand` plugin contract (`id`, `build_spec`, `init_db`, `execute_target`, `process_result`) and must be registered in `server/src/main.rs`.
- Task creation normalizes targets (`sort + dedup`) and validates each target as IP or CIDR before persistence.
- Tauri boundary naming is intentional:
  - Rust DTOs use `#[serde(rename_all = "camelCase")]` for frontend JSON.
  - Tauri `invoke` argument names often stay snake_case (`use_tls`) to match Rust command signatures.
  - Frontend normalizes backend DTOs to app types in `mapRawToTask` and related converters.
- Backend records are managed by name/id with file locking (`fs2`) in `client/src-tauri/src/utils/config.rs`; keep writes atomic and lock-protected.
- Logging uses `tracing` with non-blocking file appenders; keep returned guards alive in app entrypoints to avoid dropping file logs.
