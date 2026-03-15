# SuperScanner 架构图

```mermaid
graph TD
    classDef sharedCls  fill:#e8f5e9,stroke:#43a047,color:#1b5e20
    classDef handlerCls fill:#e3f2fd,stroke:#1e88e5,color:#0d47a1
    classDef coreCls    fill:#fff8e1,stroke:#f9a825,color:#e65100
    classDef cmdCls     fill:#fce4ec,stroke:#d81b60,color:#880e4f
    classDef storageCls fill:#ede7f6,stroke:#8e24aa,color:#4a148c
    classDef utilityCls fill:#f5f5f5,stroke:#757575,color:#212121
    classDef clientCls  fill:#e0f7fa,stroke:#00acc1,color:#006064

    subgraph SHARED["📦 super-scanner-shared"]
        SH_LOG["logging\ninit(path, log_name) → WorkerGuard"]
    end

    subgraph SERVER["📦 SuperScannerServer"]
        MAIN["main.rs\n装配入口"]
        CONFIG["config.rs\nAppConfig · ROOT_DIR · CliArgs"]
        ERROR["error.rs\nAppError"]

        subgraph HANDLER["handler/  ─  gRPC 接入层"]
            H_MOD["mod.rs\ntasks_svc_with_store(root, store, registry)\nserver_info_svc()\n── tasks_proto / status_proto ──"]
            H_TASKS["tasks.rs\nTasksService"]
            H_STATUS["status.rs\nServerInfoService"]
        end

        subgraph CORE["core/  ─  领域层"]
            TYPES["types.rs\nTaskMetadata · CommandSpec\nWorkflow · RunnerEvent"]
            TRAITS["traits.rs\nTaskStore · TaskManager\nCommandParser"]
            RUNNER["runner.rs\nBackgroundTaskRunner\nSimpleCommandParser"]
        end

        subgraph COMMANDS["commands/  ─  扫描命令层"]
            C_MOD["mod.rs\nScannerCommand trait\nCommandRegistry"]
            PING["ping.rs\nPingCommand"]
            NMAP["nmap.rs\nNmapCommand"]
            PORTSCAN["port_scan.rs\nBuiltinPortScanCommand"]
            STUBS["httpx.rs · nuclei.rs · curl.rs\n(stub)"]
        end

        subgraph STORAGE["storage/  ─  持久层"]
            FILE["file.rs\nFileTaskStore"]
            TASKDB["task_db.rs\ncreate_targets_db\nreset_targets_db\nopen_targets_db\nquery_port_results"]
        end

        subgraph UTILS["utils/"]
            S_LOG["logging.rs"]
            SIGNAL["signal.rs"]
        end
    end

    subgraph CLIENT["📦 SuperScannerClient  (Tauri)"]
        LIB["lib.rs\n命令注册"]
        CT["command/tasks.rs\nlist · get · create\nstart · stop · delete\nrestart · stream_events"]
        CS["command/server_info.rs\nprobe · add · get · delete"]
        C_LOG["utils/logging.rs"]
        CUTIL["utils/\ndto · convert · grpc · config"]
    end

    class SH_LOG sharedCls
    class MAIN,CONFIG,ERROR,S_LOG,SIGNAL utilityCls
    class H_MOD,H_TASKS,H_STATUS handlerCls
    class TYPES,TRAITS,RUNNER coreCls
    class C_MOD,PING,NMAP,PORTSCAN,STUBS cmdCls
    class FILE,TASKDB storageCls
    class LIB,CT,CS,C_LOG,CUTIL clientCls

    %% ── shared logging ──
    S_LOG -->|"wraps → server.log"| SH_LOG
    C_LOG -->|"wraps → client.log"| SH_LOG

    %% ── main 装配 ──
    MAIN --> CONFIG
    MAIN --> H_MOD
    MAIN --> S_LOG
    MAIN --> SIGNAL

    %% ── handler 内部 ──
    H_MOD --> H_TASKS & H_STATUS

    %% ── handler 依赖下层 ──
    H_TASKS --> TRAITS
    H_TASKS --> RUNNER
    H_TASKS --> C_MOD
    H_TASKS --> TASKDB

    %% ── core 内部依赖 ──
    TRAITS --> TYPES
    RUNNER --> TRAITS
    RUNNER --> TYPES
    RUNNER --> C_MOD
    RUNNER --> TASKDB

    %% ── commands 内部 ──
    C_MOD --> PING & NMAP & PORTSCAN & STUBS

    %% ── storage ──
    FILE -.->|"impl TaskStore"| TRAITS
    TASKDB --> ERROR

    %% ── client ──
    LIB --> CT & CS & C_LOG
    CT & CS --> CUTIL
```

---

## 流程图一：创建任务请求流

```mermaid
sequenceDiagram
    participant FE  as Frontend (React)
    participant C   as client/command/tasks.rs
    participant H   as handler/tasks.rs
    participant S   as storage/file.rs
    participant DB  as storage/task_db.rs

    FE  ->>  C  : create_task(address, input)
    C   ->>  H  : gRPC CreateTaskRequest
    H   ->>  H  : 校验 name / targets / workflow
    H   ->>  S  : store.create_task(meta)
    S  -->>  H  : Ok
    H   ->>  DB : create_targets_db(task_dir, targets)
    Note over DB: 展开 CIDR → 逐 IP 写入 targets.db
    DB -->>  H  : Ok
    H   ->>  H  : 写 workflow.json + spec.toml
    H  -->>  C  : ProtoTask
    C  -->>  FE : TaskDto
```

---

## 流程图二：任务执行流

```mermaid
flowchart TD
    A([start_task 请求]) --> B{任务状态?}
    B -->|RUNNING| E1([❌ failed_precondition])
    B -->|DONE| E2([❌ failed_precondition])
    B -->|PENDING / STOPPED / FAILED| C[runner.start\nspawn run_task_loop]

    C --> D[set_status → RUNNING]
    D --> E[open_targets_db]
    E --> F[/遍历 CommandSpec/]

    F --> G[cmd.init_db\n按需建表]
    G --> H[SELECT ip FROM targets\nWHERE status = 'pending']
    H --> I[并发派发\nSemaphore = 10]

    I --> J[cmd.execute_target\n单个 IP]
    J --> K[update_tx.send\n成功 / 失败]
    K --> L{buffer ≥ 50\n或全部完成?}

    L -->|否| I
    L -->|是| M[UPDATE targets SET status\n广播 Progress 事件\n保存进度到 metadata.toml]
    M --> F

    F -->|收到停止信号| P([set_status → STOPPED])
    F -->|命令出错| Q([set_status → FAILED])
    F -->|全部 CommandSpec 完成| R([set_status → DONE 100%\n广播 Snapshot 事件])
```

---

## 流程图三：任务生命周期状态机

```mermaid
stateDiagram-v2
    direction LR
    [*]     --> PENDING  : create_task

    PENDING --> RUNNING  : start_task
    RUNNING --> DONE     : 所有目标执行完毕
    RUNNING --> FAILED   : 命令执行出错
    RUNNING --> STOPPED  : stop_task

    STOPPED --> PENDING  : restart_task\n重置 targets.db
    FAILED  --> PENDING  : restart_task\n重置 targets.db
    DONE    --> PENDING  : restart_task\n重置 targets.db
```

---

## 约定

| 符号 | 含义 |
|------|------|
| 实线 `-->` | 直接依赖（use / instantiate） |
| 虚线 `-.->` | 接口实现（impl Trait） |
| 🟢 绿色 | `super-scanner-shared` |
| 🔵 蓝色 | `handler/` gRPC 接入层 |
| 🟠 橙色 | `core/` 领域层 |
| 🔴 粉色 | `commands/` 扫描命令层 |
| 🟣 紫色 | `storage/` 持久层 |
| ⚫ 灰色 | 入口 / 工具 |
| 🔵 青色 | `SuperScannerClient` |
