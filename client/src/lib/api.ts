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

const parseTs = (v: any): number | undefined =>
    typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : undefined;

/** 统一将后端 DTO（camelCase）映射为前端 Task */
function mapRawToTask(raw: any): Task {
    const status = typeof raw?.status === 'number' ? raw.status : 0;
    let progress = raw?.progress ?? 0;
    if (status === TaskStatus.DONE) progress = 100;

    return {
        id: raw?.id ?? '',
        name: raw?.name ?? '',
        description: raw?.description ?? '',
        targets: raw?.targets ?? [],
        status,
        exitCode: raw?.exitCode,
        errorMessage: raw?.errorMessage,
        createdAt: parseTs(raw?.createdAt) ?? Date.now(),
        updatedAt: parseTs(raw?.updatedAt),
        startedAt: parseTs(raw?.startedAt),
        finishedAt: parseTs(raw?.finishedAt),
        progress,
        workflow: raw?.workflow ?? { steps: [] },
        results: raw?.results ?? [],
        vulnerabilities: raw?.vulnerabilities ?? [],
    };
}

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
        });
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
        return {ok: true, data: mapRawToTask(raw)};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export async function createScanTask(address: string, input: {
    name: string;
    description?: string;
    targets: string[];
    workflow: any;
}, useTls?: boolean): Promise<ApiResult<Task>> {
    try {
        const raw = await invoke<any>('create_task', {address, input, use_tls: !!useTls});
        return {ok: true, data: mapRawToTask(raw)};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export async function startScan(address: string, id: string, useTls?: boolean): Promise<ApiResult<null>> {
    try {
        await invoke('start_task', {address, id, use_tls: !!useTls});
        return {ok: true, data: null};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export async function stopScan(address: string, id: string, useTls?: boolean): Promise<ApiResult<null>> {
    try {
        await invoke('stop_task', {address, id, use_tls: !!useTls});
        return {ok: true, data: null};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export async function listTasks(address: string, useTls?: boolean): Promise<ApiResult<Task[]>> {
    try {
        const raw = await invoke<any[]>('list_tasks', {address, use_tls: !!useTls});
        const tasks: Task[] = (raw ?? []).map(mapRawToTask);
        return {ok: true, data: tasks};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export async function getServerInfo(address: string, useTls?: boolean): Promise<ApiResult<ServerInfo>> {
    try {
        const raw = await invoke<any>('get_server_info', {address, use_tls: !!useTls});
        return {ok: true, data: normalizeServerInfoDto(raw)};
    } catch (e) {
        return {ok: false, error: textErr(e)};
    }
}

export function normalizeServerInfoDto(raw: any): ServerInfo {
    const toNumber = (v: any, fallback = 0) => {
        if (v === null || v === undefined || v === '') return fallback;
        if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
        if (typeof v === 'string') {
            const n = Number(v.replace(/,/g, ''));
            return Number.isFinite(n) ? n : fallback;
        }
        return Number.isFinite(Number(v)) ? Number(v) : fallback;
    };

    return {
        hostname: raw?.hostname ?? '',
        os: raw?.os ?? '',
        uptimeSeconds: toNumber(raw?.uptimeSeconds),
        cpuCores: toNumber(raw?.cpuCores),
        memoryTotalBytes: toNumber(raw?.memoryTotalBytes),
        memoryFreeBytes: toNumber(raw?.memoryFreeBytes),
        version: raw?.version ?? '',
        loadAverage: Array.isArray(raw?.loadAverage) ? raw.loadAverage.map((x: any) => toNumber(x)) : [],
        diskTotalBytes: toNumber(raw?.diskTotalBytes),
        diskFreeBytes: toNumber(raw?.diskFreeBytes),
        tools: Array.isArray(raw?.tools)
            ? raw.tools.map((tool: any) => ({
                toolId: tool?.toolId ?? '',
                available: !!tool?.available,
                source: tool?.source ?? '',
                path: tool?.path ?? '',
            }))
            : [],
    };
}

export async function restartScan(address: string, id: string, useTls?: boolean): Promise<ApiResult<Task>> {
    try {
        const raw = await invoke<any>('restart_task', {address, id, clear_logs: true, start_now: true, use_tls: !!useTls});
        if (!raw) return {ok: false, error: 'task not found'};
        return {ok: true, data: mapRawToTask(raw)};
    } catch (e) {
        return {ok: false, error: textErr(e)};
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
