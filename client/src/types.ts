// NOTE: BackendType removed — backend "type" semantic has been deprecated.

// Proto: tasks.v1.TaskStatus
export enum TaskStatus {
  UNSPECIFIED = 0,
  PENDING = 1,
  RUNNING = 2,
  DONE = 3,
  FAILED = 4,
  STOPPED = 5,
  PAUSED = 6
}

export interface ScanTarget {
  target: string;
  portRange?: string;
  options?: Record<string, any>;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface Task {
  id: string;
  name: string;
  description: string; // Proto field
  targets: string[];   // Proto field (repeated string)

  status: TaskStatus;

  // Execution details
  exitCode?: number;      // Proto field
  errorMessage?: string;  // Proto field

  // Timestamps (Proto uses google.protobuf.Timestamp, mapped to number/epoch here)
  createdAt: number;
  updatedAt?: number;
  startedAt?: number;
  finishedAt?: number;

  // -- UI/Implementation Specific Extensions (Not in generic Task proto) --
  backendId?: string;
  // `backend` (type field) removed. Use `backendId` to reference a backend.
  progress: number;
  logs: LogEntry[];
  result?: string;
}

export interface BackendConfig {
  id: string;
  name: string;
  description?: string;
  address?: string;
  useTls?: boolean;
  serverInfo?: ServerInfo;
  createdAt?: number;
  lastProbeAt?: number;
  probeConfig?: { timeoutMs: number; retries: number };
}

export interface NetworkInterface {
  name: string;
  ipAddresses: string[];
}

export interface ServerInfo {
  hostname: string;
  os: string;
  uptimeSeconds: number;
  cpuCores: number;
  memoryTotalBytes: number;
  memoryFreeBytes: number;
  version: string;
  loadAverage: number[];
  diskTotalBytes: number;
  diskFreeBytes: number;
}

export type TaskAction =
  | { type: 'CREATE_TASK'; payload: Task }
  | { type: 'UPDATE_TASK'; payload: Partial<Task> & { id: string } }
  | { type: 'DELETE_TASK'; payload: string };
