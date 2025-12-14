import {invoke} from '@tauri-apps/api/core';
import {BackendConfig, ServerInfo, Task, TaskStatus} from '../types';

export type ApiResult<T> = { ok: true; data: T } | { ok: false, error: string };

const textErr = (e: unknown) => {
    try {
        // @ts-ignore
        return String(e?.message ?? e ?? 'Unknown error');
    } catch {
        return 'Unknown error';
    }
};

export async function getBackends(): Promise<ApiResult<BackendConfig[]>> {
    try {
        const data = await invoke<BackendConfig[]>('get_backends');
        return {ok: true, data};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export async function addBackendWithProbe(payload: {
    name: string;
    address: string;
    description?: string | null;
    useTls: boolean
}): Promise<ApiResult<BackendConfig | null>> {
    try {
        await invoke('add_backend_with_probe', {
            name: payload.name,
            address: payload.address,
            description: payload.description ?? null,
            use_tls: payload.useTls,
            useTls: payload.useTls
        });
        // backend creation may not return the created object; caller can re-fetch
        return {ok: true, data: null};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export async function deleteBackend(identifier: string): Promise<ApiResult<null>> {
    try {
        await invoke('delete_backend', {identifier});
        return {ok: true, data: null};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export async function deleteTask(address: string, id: string, useTls?: boolean): Promise<ApiResult<null>> {
    try {
        await invoke('delete_task', {address, id, use_tls: !!useTls});
        return {ok: true, data: null};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export async function getTask(address: string, id: string, useTls?: boolean): Promise<ApiResult<Task>> {
    try {
        const raw = await invoke<any>('get_task', {address, id, use_tls: !!useTls});
        // Map raw DTO to frontend Task shape (similar to listTasks logic)
        const createdRaw = raw?.created_at ?? raw?.createdAt;
        const startedRaw = raw?.started_at ?? raw?.startedAt;
        const finishedRaw = raw?.finished_at ?? raw?.finishedAt;
        
        const task: Task = {
            id: raw?.id ?? '',
            name: raw?.name ?? '',
            description: raw?.description ?? raw?.desc ?? '',
            targets: raw?.targets ?? [],
            status: (typeof raw?.status === 'number') ? raw.status : 0,
            exitCode: raw?.exit_code ?? raw?.exitCode,
            errorMessage: raw?.error_message ?? raw?.errorMessage,
            createdAt: createdRaw ? Date.parse(createdRaw) : Date.now(),
            updatedAt: undefined,
            startedAt: startedRaw ? Date.parse(startedRaw) : undefined,
            finishedAt: finishedRaw ? Date.parse(finishedRaw) : undefined,
            progress: raw?.progress ?? 0,
            logs: [],
        };
        return {ok: true, data: task};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export async function createScanTask(address: string, input: {
    name: string;
    description?: string;
    targets: string[]
}, use_tls?: boolean): Promise<ApiResult<Task>> {
    try {
        // tauri command expects: (address, input, use_tls)
        const newTask = await invoke<Task>('create_scan_task', {address, input, use_tls});
        return {ok: true, data: newTask};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export async function startScan(address: string, id: string, use_tls?: boolean): Promise<ApiResult<null>> {
    try {
        await invoke('start_scan', {address, id, use_tls});
        return {ok: true, data: null};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export async function stopScan(address: string, id: string, useTls?: boolean): Promise<ApiResult<null>> {
    try {
        await invoke('stop_scan', {address, id, use_tls: !!useTls});
        return {ok: true, data: null};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export async function listTasks(address: string, useTls?: boolean): Promise<ApiResult<Task[]>> {
    try {
        const raw = await invoke<any[]>('list_tasks', {address, use_tls: !!useTls});
        // raw is an array of TaskDto-like objects; map to frontend Task shape
        const tasks: Task[] = (raw ?? []).map((d: any) => {
            const createdRaw = d?.created_at ?? d?.createdAt ?? d?.createdAt;
            const startedRaw = d?.started_at ?? d?.startedAt;
            const finishedRaw = d?.finished_at ?? d?.finishedAt;
            const createdAt = createdRaw ? Date.parse(createdRaw) : Date.now();
            const startedAt = startedRaw ? Date.parse(startedRaw) : undefined;
            const finishedAt = finishedRaw ? Date.parse(finishedRaw) : undefined;
            const status = (typeof d?.status === 'number') ? d.status : 0;
            // Use persisted progress from server if available, otherwise fallback to status-based logic
            let progress = d?.progress ?? 0;
            if (status === TaskStatus.DONE) {
                progress = 100;
            }
            
            return {
                id: d?.id ?? '',
                name: d?.name ?? '',
                description: d?.description ?? d?.desc ?? '',
                targets: d?.targets ?? [],
                status: status,
                exitCode: d?.exit_code ?? d?.exitCode ?? undefined,
                errorMessage: d?.error_message ?? d?.errorMessage ?? undefined,
                createdAt: createdAt,
                updatedAt: undefined,
                startedAt: startedAt,
                finishedAt: finishedAt,
                progress: progress,
                logs: [],
            } as Task;
        });
        return {ok: true, data: tasks};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export async function getServerInfo(address: string, useTls?: boolean): Promise<ApiResult<ServerInfo>> {
    try {
        const raw = await invoke<any>('get_server_info', {address, use_tls: !!useTls});
        const info = normalizeServerInfoDto(raw);
        return {ok: true, data: info};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

// Normalize server info coming from the backend (supports snake_case and camelCase inputs)
export function normalizeServerInfoDto(raw: any): ServerInfo {
    const toNumber = (v: any, fallback = 0) => {
        if (v === null || v === undefined || v === '') return fallback;
        if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
        if (typeof v === 'string') {
            const n = Number(v.replace(/,/g, ''));
            return Number.isFinite(n) ? n : fallback;
        }
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };

    const getArray = (a: any) => {
        if (!a) return [] as number[];
        if (!Array.isArray(a)) return [] as number[];
        return a.map((x: any) => toNumber(x, 0));
    };


    return {
        hostname: raw?.hostname ?? raw?.host_name ?? '',
        os: raw?.os ?? raw?.operating_system ?? '',
        uptimeSeconds: toNumber(raw?.uptimeSeconds ?? raw?.uptime_seconds ?? 0, 0),
        cpuCores: toNumber(raw?.cpuCores ?? raw?.cpu_cores ?? 0, 0),
        memoryTotalBytes: toNumber(raw?.memoryTotalBytes ?? raw?.memory_total_bytes ?? 0, 0),
        memoryFreeBytes: toNumber(raw?.memoryFreeBytes ?? raw?.memory_free_bytes ?? 0, 0),
        version: raw?.version ?? raw?.release ?? '',
        loadAverage: getArray(raw?.loadAverage ?? raw?.load_average ?? []),
        diskTotalBytes: toNumber(raw?.diskTotalBytes ?? raw?.disk_total_bytes ?? 0, 0),
        diskFreeBytes: toNumber(raw?.diskFreeBytes ?? raw?.disk_free_bytes ?? 0, 0),
    };
}

export async function restartScan(address: string, id: string, useTls?: boolean): Promise<ApiResult<Task>> {
    try {
        // Try to fetch current task details via tauri command get_task
        // If the frontend already has task metadata, callers can use createScanTask directly.
        const taskDto = await invoke<any>('get_task', { address, id, use_tls: !!useTls });
        if (!taskDto) return { ok: false, error: 'task not found' };
        const input = { name: taskDto.name ?? 'task', description: taskDto.description ?? '', targets: taskDto.targets ?? [] };
        const createRes = await createScanTask(address, input, useTls);
        if (!createRes.ok) return { ok: false, error: createRes.error };
        const newTask = createRes.data;
        const startRes = await startScan(address, newTask.id, useTls);
        if (!startRes.ok) return { ok: false, error: startRes.error };
        return { ok: true, data: newTask };
    } catch (e) {
        return { ok: false, error: textErr(e) };
    }
}


export async function streamTaskEvents(address: string, id: string, useTls?: boolean): Promise<ApiResult<null>> {
    try {
        await invoke('stream_task_events', {address, id, use_tls: !!useTls});
        return {ok: true, data: null};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export default {
    getBackends,
    addBackendWithProbe,
    deleteBackend,
    deleteTask,
    createScanTask,
    startScan,
    stopScan,
    restartScan,
    getTask,
    listTasks,
    getServerInfo,
    streamTaskEvents,
};
