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

export enum ScanType {
  Unspecified = 0,
  Port = 1,
  Fingerprint = 2,
  Poc = 3,
  Fscan = 4
}

export interface WorkflowStep {
  type: ScanType;
  tool: string;
}

export interface Workflow {
  steps: WorkflowStep[];
}

export interface ScanTarget {
  target: string;
  portRange?: string;
  options?: Record<string, any>;
}

export interface ScanResult {
  ip: string;
  port: number;
  protocol: string;
  state: string;
  service: string;
  tool: string;
  timestamp: string;
  vulnerabilityId?: string;
  severity?: string;
  title?: string;
  evidence?: string;
  vulnStatus?: string;
}

export interface Finding {
  id: number;
  dedupeKey: string;
  findingType: string;
  severity: string;
  title: string;
  detail: string;
  ip: string;
  port: number;
  protocol: string;
  sourceTool: string;
  sourceCommand: string;
  metadataJson: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
}

export interface VulnerabilityRecord {
  id?: string;
  severity?: string;
  title?: string;
  target?: string;
  evidence?: string;
  status?: string;
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
  result?: string;
  workflow: Workflow;
  results: ScanResult[];
  findings: Finding[];
  vulnerabilities?: VulnerabilityRecord[];
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
  tools: ToolCapability[];
  nucleiTemplates?: NucleiTemplatesStatus;
}

export interface ToolCapability {
  toolId: string;
  available: boolean;
  source: string;
  path: string;
}

export interface NucleiTemplatesStatus {
  source: string;
  configuredLocalPath: string;
  effectivePath: string;
  repoUrl: string;
  cachePath: string;
  lastSyncUnix: number;
  lastError: string;
  syncSupported: boolean;
}

export type TaskAction =
  | { type: 'CREATE_TASK'; payload: Task }
  | { type: 'UPDATE_TASK'; payload: Partial<Task> & { id: string } }
  | { type: 'DELETE_TASK'; payload: string };
