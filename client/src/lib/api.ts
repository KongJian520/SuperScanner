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
    console.log('[API] getBackends called');
    try {
        const data = await invoke<BackendConfig[]>('get_backends');
        console.log('[API] getBackends success:', data);
        return {ok: true, data};
    } catch (e) {
        console.error('[API] getBackends error:', e);
        return {ok: false, error: textErr(e)};
    }
}

export async function addBackendWithProbe(payload: {
    name: string;
    address: string;
    description?: string | null;
    useTls: boolean
}): Promise<ApiResult<BackendConfig | null>> {
    console.log('[API] addBackendWithProbe called', payload);
    try {
        await invoke('add_backend_with_probe', {
            name: payload.name,
            address: payload.address,
            description: payload.description ?? null,
            use_tls: payload.useTls,
            useTls: payload.useTls
        });
        console.log('[API] addBackendWithProbe success');
        // backend creation may not return the created object; caller can re-fetch
        return {ok: true, data: null};
    } catch (e) {
        console.error('[API] addBackendWithProbe error:', e);
        return {ok: false, error: textErr(e)};
    }
}

export async function deleteBackend(identifier: string): Promise<ApiResult<null>> {
    console.log('[API] deleteBackend called', identifier);
    try {
        await invoke('delete_backend', {identifier});
        console.log('[API] deleteBackend success');
        return {ok: true, data: null};
    } catch (e) {
        console.error('[API] deleteBackend error:', e);
        return {ok: false, error: textErr(e)};
    }
}

export async function deleteTask(address: string, id: string, useTls?: boolean): Promise<ApiResult<null>> {
    console.log('[API] deleteTask called', { address, id, useTls });
    try {
        await invoke('delete_task', {address, id, use_tls: !!useTls});
        console.log('[API] deleteTask success');
        return {ok: true, data: null};
    } catch (e) {
        console.error('[API] deleteTask error:', e);
        return {ok: false, error: textErr(e)};
    }
}

export async function getTask(address: string, id: string, useTls?: boolean): Promise<ApiResult<Task>> {
    // console.log('[API] getTask called', { address, id, useTls });
    try {
        const raw = await invoke<any>('get_task', {address, id, use_tls: !!useTls});
        // console.log('[API] getTask raw response:', raw);
        // Map raw DTO to frontend Task shape (similar to listTasks logic)
        const createdRaw = raw?.createdAt;
        const startedRaw = raw?.startedAt;
        const finishedRaw = raw?.finishedAt;
        
        const task: Task = {
            id: raw?.id ?? '',
            name: raw?.name ?? '',
            description: raw?.description ?? '',
            targets: raw?.targets ?? [],
            status: (typeof raw?.status === 'number') ? raw.status : 0,
            exitCode: raw?.exitCode,
            errorMessage: raw?.errorMessage,
            createdAt: createdRaw ? Date.parse(createdRaw) : Date.now(),
            updatedAt: undefined,
            startedAt: startedRaw ? Date.parse(startedRaw) : undefined,
            finishedAt: finishedRaw ? Date.parse(finishedRaw) : undefined,
            progress: raw?.progress ?? 0,
            workflow: raw?.workflow ?? { steps: [] },
            results: raw?.results ?? [],
        };
        console.log('[API] getTask mapped data:', task);
        return {ok: true, data: task};
    } catch (e) {
        console.error('[API] getTask error:', e);
        return {ok: false, error: textErr(e)};
    }
}

export async function createScanTask(address: string, input: {
    name: string;
    description?: string;
    targets: string[];
    workflow: any;
}, use_tls?: boolean): Promise<ApiResult<Task>> {
    console.log('[API] createScanTask called', { address, input, use_tls });
    try {
        // tauri command expects: (address, input, use_tls)
        const newTask = await invoke<Task>('create_scan_task', {address, input, use_tls});
        console.log('[API] createScanTask success:', newTask);
        return {ok: true, data: newTask};
    } catch (e) {
        console.error('[API] createScanTask error:', e);
        return {ok: false, error: textErr(e)};
    }
}

export async function startScan(address: string, id: string, use_tls?: boolean): Promise<ApiResult<null>> {
    console.log('[API] startScan called', { address, id, use_tls });
    try {
        await invoke('start_scan', {address, id, use_tls});
        console.log('[API] startScan success');
        return {ok: true, data: null};
    } catch (e) {
        console.error('[API] startScan error:', e);
        return {ok: false, error: textErr(e)};
    }
}

export async function stopScan(address: string, id: string, useTls?: boolean): Promise<ApiResult<null>> {
    console.log('[API] stopScan called', { address, id, useTls });
    try {
        await invoke('stop_scan', {address, id, use_tls: !!useTls});
        console.log('[API] stopScan success');
        return {ok: true, data: null};
    } catch (e) {
        console.error('[API] stopScan error:', e);
        return {ok: false, error: textErr(e)};
    }
}

export async function listTasks(address: string, useTls?: boolean): Promise<ApiResult<Task[]>> {
    console.log('[API] listTasks called', { address, useTls });
    try {
        const raw = await invoke<any[]>('list_tasks', {address, use_tls: !!useTls});
        console.log('[API] listTasks raw response:', raw);
        // raw is an array of TaskDto-like objects; map to frontend Task shape
        const tasks: Task[] = (raw ?? []).map((d: any) => {
            const createdRaw = d?.createdAt;
            const startedRaw = d?.startedAt;
            const finishedRaw = d?.finishedAt;
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
                description: d?.description ?? '',
                targets: d?.targets ?? [],
                status: status,
                exitCode: d?.exitCode ?? undefined,
                errorMessage: d?.errorMessage ?? undefined,
                createdAt: createdAt,
                updatedAt: undefined,
                startedAt: startedAt,
                finishedAt: finishedAt,
                progress: progress,
            } as Task;
        });
        console.log('[API] listTasks mapped data:', tasks);
        return {ok: true, data: tasks};
    } catch (e) {
        console.error('[API] listTasks error:', e);
        return {ok: false, error: textErr(e)};
    }
}

export async function getServerInfo(address: string, useTls?: boolean): Promise<ApiResult<ServerInfo>> {
    console.log('[API] getServerInfo called', { address, useTls });
    try {
        const raw = await invoke<any>('get_server_info', {address, use_tls: !!useTls});
        console.log('[API] getServerInfo raw response:', raw);
        const info = normalizeServerInfoDto(raw);
        console.log('[API] getServerInfo normalized:', info);
        return {ok: true, data: info};
    } catch (e) {
        console.error('[API] getServerInfo error:', e);
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
        hostname: raw?.hostname ?? '',
        os: raw?.os ?? '',
        uptimeSeconds: toNumber(raw?.uptimeSeconds ?? 0, 0),
        cpuCores: toNumber(raw?.cpuCores ?? 0, 0),
        memoryTotalBytes: toNumber(raw?.memoryTotalBytes ?? 0, 0),
        memoryFreeBytes: toNumber(raw?.memoryFreeBytes ?? 0, 0),
        version: raw?.version ?? '',
        loadAverage: getArray(raw?.loadAverage ?? []),
        diskTotalBytes: toNumber(raw?.diskTotalBytes ?? 0, 0),
        diskFreeBytes: toNumber(raw?.diskFreeBytes ?? 0, 0),
    };
}

export async function restartScan(address: string, id: string, useTls?: boolean): Promise<ApiResult<Task>> {
    console.log('[API] restartScan called', { address, id, useTls });
    try {
        // Use the tauri command wrapper that calls server RestartTask RPC
        const taskDto = await invoke<any>('restart_task', { address, id, clear_logs: true, start_now: true, use_tls: !!useTls });
        if (!taskDto) {
            console.warn('[API] restartScan: task not found');
            return { ok: false, error: 'task not found' };
        }

        // Map returned DTO to frontend Task shape (similar to getTask)
        const createdRaw = taskDto?.created_at ?? taskDto?.createdAt;
        const startedRaw = taskDto?.started_at ?? taskDto?.startedAt;
        const finishedRaw = taskDto?.finished_at ?? taskDto?.finishedAt;

        const task: Task = {
            id: taskDto?.id ?? '',
            name: taskDto?.name ?? '',
            description: taskDto?.description ?? taskDto?.desc ?? '',
            targets: taskDto?.targets ?? [],
            status: (typeof taskDto?.status === 'number') ? taskDto.status : 0,
            exitCode: taskDto?.exit_code ?? taskDto?.exitCode,
            errorMessage: taskDto?.error_message ?? taskDto?.errorMessage,
            createdAt: createdRaw ? Date.parse(createdRaw) : Date.now(),
            updatedAt: undefined,
            startedAt: startedRaw ? Date.parse(startedRaw) : undefined,
            finishedAt: finishedRaw ? Date.parse(finishedRaw) : undefined,
            progress: taskDto?.progress ?? 0,
            workflow: taskDto?.workflow ?? { steps: [] },
        };

        console.log('[API] restartScan success:', task);
        return { ok: true, data: task };
    } catch (e) {
        console.error('[API] restartScan error:', e);
        return { ok: false, error: textErr(e) };
    }
}


export async function streamTaskEvents(address: string, id: string, useTls?: boolean): Promise<ApiResult<null>> {
    console.log('[API] streamTaskEvents called', { address, id, useTls });
    try {
        await invoke('stream_task_events', {address, id, use_tls: !!useTls});
        console.log('[API] streamTaskEvents success');
        return {ok: true, data: null};
    } catch (e) {
        console.error('[API] streamTaskEvents error:', e);
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
