import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import * as api from '../lib/api';
import { BackendConfig, Task, TaskStatus } from '../types';
import { toast } from 'sonner';
import i18n from '../lib/i18n';

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return String(err ?? 'Unknown error');
};

const parseTs = (ts: unknown): number | undefined => {
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : undefined;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const sanitizeEventSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9]/g, '_');

// --- Backends ---

export function useBackends() {
  return useQuery({
    queryKey: ['backends'],
    queryFn: async () => {
      const res = await api.getBackends();
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useAddBackend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string; address: string; description?: string | null; useTls: boolean }) => {
      const res = await api.addBackendWithProbe(payload);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backends'] });
      toast.success(i18n.t('toast.backend_add_success', { defaultValue: 'Backend added successfully' }));
    },
    onError: (err) => {
      toast.error(i18n.t('toast.backend_add_error', { defaultValue: 'Failed to add backend: {{message}}', message: getErrorMessage(err) }));
    },
  });
}

export function useDeleteBackend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.deleteBackend(id);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backends'] });
      toast.success(i18n.t('toast.backend_delete_success', { defaultValue: 'Backend deleted' }));
    },
    onError: (err) => {
      toast.error(i18n.t('toast.backend_delete_error', { defaultValue: 'Failed to delete backend: {{message}}', message: getErrorMessage(err) }));
    },
  });
}

// --- Tasks ---

export function useTasks(backendId: string | null) {
  const { data: backends } = useBackends();
  const backend = backends?.find((b) => b.id === backendId);
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['tasks', backendId],
    queryFn: async () => {
      if (!backend?.address) throw new Error('Backend address not found');
      const res = await api.listTasks(backend.address, !!backend.useTls);
      if (!res.ok) throw new Error(res.error);

      const newTasks = res.data.map(t => ({ ...t, backendId: backend.id }));

      // Smart Merge: 保留本地进度（可能比 DB 更新）
      const oldTasks = queryClient.getQueryData<Task[]>(['tasks', backendId]);
      if (!oldTasks) return newTasks;

      return newTasks.map(nt => {
        const ot = oldTasks.find(t => t.id === nt.id);
        if (!ot) return nt;
        if (nt.status === TaskStatus.RUNNING) {
          return { ...nt, progress: Math.max(nt.progress, ot.progress) };
        }
        return nt;
      });
    },
    enabled: !!backend?.address,
    staleTime: 5000,
    refetchInterval: 10000,
  });
}

function stabilizeProgress(current: number, incoming: number, status: TaskStatus): number {
  if (status === TaskStatus.DONE) return 100;
  if (status === TaskStatus.RUNNING) return Math.max(current, incoming);
  if (status === TaskStatus.PENDING) return 0;
  return incoming;
}

// Helper to apply event updates to a task
function applyTaskUpdate(t: Task, payload: any): Task {
  if (payload.type === 'Progress') {
    return {
      ...t,
      progress: stabilizeProgress(t.progress, payload.payload.percent, t.status),
    };
  }
  if (payload.type === 'TaskSnapshot') {
    const snap = payload.payload;
    const nextStatus = snap.status ?? t.status;
    const incomingProgress = snap.progress ?? t.progress;
    const newProgress = stabilizeProgress(t.progress, incomingProgress, nextStatus);
    return {
      ...t,
      status: nextStatus,
      progress: newProgress,
      exitCode: snap.exitCode,
      errorMessage: snap.errorMessage,
      startedAt: parseTs(snap.startedAt) ?? t.startedAt,
      finishedAt: parseTs(snap.finishedAt) ?? t.finishedAt,
      updatedAt: parseTs(snap.updatedAt) ?? t.updatedAt,
    };
  }
  return t;
}

// Global map to avoid attaching multiple Tauri listeners for the same task
type ActiveListener = { count: number; unlisten?: () => void; removed?: boolean };
const activeTaskListeners: Map<string, ActiveListener> = new Map();
const bootstrappedTaskStreams: Set<string> = new Set();
const reconnectingTaskStreams: Set<string> = new Set();

export function useTaskEvents(backendId: string | null, taskId: string | null) {
  const { data: backends } = useBackends();
  const backend = backends?.find((b) => b.id === backendId);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!backend?.address || !taskId) return;
    const streamKey = `${backendId ?? 'default'}:${taskId}`;
    const eventName = `task-event://${sanitizeEventSegment(backend.address)}::${taskId}`;

    let localRemoved = false;
    let frameId: number | null = null;
    const pendingPayloads: any[] = [];

    const flushPending = () => {
      frameId = null;
      if (pendingPayloads.length === 0) return;
      const payloads = pendingPayloads.splice(0, pendingPayloads.length);

      queryClient.setQueryData(['tasks', backendId], (oldTasks: Task[] | undefined) => {
        if (!oldTasks) return oldTasks;
        return oldTasks.map((task) => {
          if (task.id !== taskId) return task;
          return payloads.reduce((nextTask, payload) => applyTaskUpdate(nextTask, payload), task);
        });
      });

      queryClient.setQueryData(['task', backendId, taskId], (oldTask: Task | undefined) => {
        if (!oldTask) return oldTask;
        return payloads.reduce((nextTask, payload) => applyTaskUpdate(nextTask, payload), oldTask);
      });
    };

    const queuePayload = (payload: any) => {
      pendingPayloads.push(payload);
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(flushPending);
    };

    const startListening = async () => {
      const existing = activeTaskListeners.get(streamKey);
      if (existing) {
        existing.count += 1;
        return;
      }

      // Reserve entry immediately to avoid races from concurrent mounts
      activeTaskListeners.set(streamKey, { count: 1, unlisten: undefined, removed: false });

      if (!bootstrappedTaskStreams.has(streamKey)) {
        try {
          await api.streamTaskEvents(backend.address!, taskId, !!backend.useTls);
          bootstrappedTaskStreams.add(streamKey);
        } catch {
          const cur = activeTaskListeners.get(streamKey);
          if (cur && cur.count <= 1) activeTaskListeners.delete(streamKey);
          return;
        }
      }

      const unlisten = await listen(eventName, (event: any) => {
        const payload = event.payload;
        if (payload?.type === 'Error') {
          const message = getErrorMessage(payload?.payload?.message ?? payload?.payload);
          toast.error(i18n.t('toast.task_stream_error', { defaultValue: 'Task event stream disconnected: {{message}}', message }));
          bootstrappedTaskStreams.delete(streamKey);

          if (!reconnectingTaskStreams.has(streamKey)) {
            reconnectingTaskStreams.add(streamKey);
            void api
              .streamTaskEvents(backend.address!, taskId, !!backend.useTls)
              .then((res) => {
                if (res.ok) bootstrappedTaskStreams.add(streamKey);
              })
              .finally(() => {
                reconnectingTaskStreams.delete(streamKey);
              });
          }
          return;
        }

        queuePayload(payload);
      });

      const cur = activeTaskListeners.get(streamKey);
      if (cur) {
        cur.unlisten = unlisten;
        if (cur.removed) {
          unlisten();
          activeTaskListeners.delete(streamKey);
        }
      }
    };

    startListening();

    return () => {
      localRemoved = true;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
      pendingPayloads.length = 0;
      const existing = activeTaskListeners.get(streamKey);
      if (existing) {
        existing.count -= 1;
        if (existing.count <= 0) {
          if (existing.unlisten) existing.unlisten();
          activeTaskListeners.delete(streamKey);
          bootstrappedTaskStreams.delete(streamKey);
          reconnectingTaskStreams.delete(streamKey);
        } else if (localRemoved) {
          existing.removed = true;
        }
      }
    };
  }, [backend?.address, backend?.useTls, taskId, queryClient, backendId]);
}

export function useTaskDetail(backendId: string | null, taskId: string | null) {
  const { data: backends } = useBackends();
  const backend = backends?.find((b) => b.id === backendId);
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['task', backendId, taskId],
    queryFn: async () => {
      if (!backend?.address || !taskId) throw new Error('Invalid context');
      const res = await api.getTask(backend.address, taskId, !!backend.useTls);
      if (!res.ok) throw new Error(res.error);
      const next = { ...res.data, backendId: backend.id };
      const prev = queryClient.getQueryData<Task>(['task', backendId, taskId]);
      if (!prev) return next;
      return {
        ...next,
        progress: stabilizeProgress(prev.progress, next.progress, next.status),
      };
    },
    enabled: !!backend?.address && !!taskId,
    refetchInterval: (query) => {
      const task = query.state.data as Task | undefined;
      if (task && (task.status === TaskStatus.DONE || task.status === TaskStatus.FAILED || task.status === TaskStatus.STOPPED)) {
        return false;
      }
      return 5000;
    },
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  const { data: backends } = useBackends();

  return useMutation({
    mutationFn: async (payload: {
      backendId: string;
      name: string;
      description?: string;
      targets: string[];
      workflow: any;
    }) => {
      const backend = backends?.find(b => b.id === payload.backendId);
      if (!backend?.address) throw new Error('Backend not found');

      const res = await api.createScanTask(
        backend.address,
        { name: payload.name, description: payload.description, targets: payload.targets, workflow: payload.workflow },
        !!backend.useTls
      );
      if (!res.ok) throw new Error(res.error);
      return { ...res.data, backendId: backend.id };
    },
    onSuccess: (_data, variables) => {
      queryClient.setQueryData(['tasks', variables.backendId], (oldTasks: Task[] | undefined) => {
        if (!oldTasks) return [_data];
        return [...oldTasks, _data];
      });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.backendId] });
      toast.success(i18n.t('toast.task_create_success', { defaultValue: 'Task created successfully' }));
    },
    onError: (err) => {
      toast.error(i18n.t('toast.task_create_error', { defaultValue: 'Failed to create task: {{message}}', message: getErrorMessage(err) }));
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  const { data: backends } = useBackends();

  return useMutation({
    mutationFn: async (payload: { backendId: string; taskId: string }) => {
      const backend = backends?.find(b => b.id === payload.backendId);
      if (!backend?.address) throw new Error('Backend not found');
      const res = await api.deleteTask(backend.address, payload.taskId, !!backend.useTls);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.backendId] });
      toast.success(i18n.t('toast.task_delete_success', { defaultValue: 'Task deleted' }));
    },
    onError: (err) => {
      toast.error(i18n.t('toast.task_delete_error', { defaultValue: 'Failed to delete task: {{message}}', message: getErrorMessage(err) }));
    },
  });
}

export function useStartTask() {
  const queryClient = useQueryClient();
  const { data: backends } = useBackends();

  return useMutation({
    mutationFn: async (payload: { backendId: string; taskId: string }) => {
      const backend = backends?.find(b => b.id === payload.backendId);
      if (!backend?.address) throw new Error('Backend not found');
      const res = await api.startScan(backend.address, payload.taskId, !!backend.useTls);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.setQueryData(['tasks', variables.backendId], (oldTasks: Task[] | undefined) => {
        if (!oldTasks) return oldTasks;
        return oldTasks.map(t => t.id === variables.taskId ? { ...t, status: TaskStatus.RUNNING } : t);
      });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.backendId] });
      toast.success(i18n.t('toast.task_start_success', { defaultValue: 'Task started' }));
    },
    onError: (err) => {
      toast.error(i18n.t('toast.task_start_error', { defaultValue: 'Failed to start task: {{message}}', message: getErrorMessage(err) }));
    },
  });
}

export function useStopTask() {
  const queryClient = useQueryClient();
  const { data: backends } = useBackends();

  return useMutation({
    mutationFn: async (payload: { backendId: string; taskId: string }) => {
      const backend = backends?.find(b => b.id === payload.backendId);
      if (!backend?.address) throw new Error('Backend not found');
      const res = await api.stopScan(backend.address, payload.taskId, !!backend.useTls);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.backendId] });
      toast.success(i18n.t('toast.task_stop_success', { defaultValue: 'Task stopped' }));
    },
    onError: (err) => {
      toast.error(i18n.t('toast.task_stop_error', { defaultValue: 'Failed to stop task: {{message}}', message: getErrorMessage(err) }));
    },
  });
}

export function useServerInfo(backendId: string | null) {
  const { data: backends } = useBackends();
  const backend = backends?.find(b => b.id === backendId);

  return useQuery({
    queryKey: ['serverInfo', backendId],
    queryFn: async () => {
      if (!backend?.address) throw new Error('Backend not found');
      const res = await api.getServerInfo(backend.address, !!backend.useTls);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: !!backend?.address,
    refetchInterval: 10000,
  });
}

export type BackendHealthState = 'online' | 'offline' | 'unknown';
export interface BackendHealthSnapshot {
  state: BackendHealthState;
  latencyMs: number | null;
  checkedAt: number;
}

export function useBackendHealth(backends: BackendConfig[]) {
  return useQuery({
    queryKey: ['backend-health', backends.map((b) => `${b.id}:${b.address}:${b.useTls ? '1' : '0'}`)],
    queryFn: async () => {
      const entries = await Promise.all(backends.map(async (backend) => {
        if (!backend.address) {
          return [backend.id, { state: 'unknown', latencyMs: null, checkedAt: Date.now() } satisfies BackendHealthSnapshot] as const;
        }
        const start = performance.now();
        const res = await api.getServerInfo(backend.address, !!backend.useTls);
        const latency = Math.max(1, Math.round(performance.now() - start));
        if (!res.ok) {
          return [backend.id, { state: 'offline', latencyMs: null, checkedAt: Date.now() } satisfies BackendHealthSnapshot] as const;
        }
        return [backend.id, { state: 'online', latencyMs: latency, checkedAt: Date.now() } satisfies BackendHealthSnapshot] as const;
      }));
      return Object.fromEntries(entries) as Record<string, BackendHealthSnapshot>;
    },
    enabled: backends.length > 0,
    staleTime: 1000 * 10,
    refetchInterval: 1000 * 15,
  });
}
