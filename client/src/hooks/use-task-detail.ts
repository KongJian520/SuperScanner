import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import * as api from '../lib/api';
import { Task, TaskStatus } from '../types';
import { toast } from 'sonner';
import i18n from '../lib/i18n';
import { useBackends } from './use-backends';

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

function stabilizeProgress(current: number, incoming: number, status: TaskStatus): number {
  if (status === TaskStatus.DONE) return 100;
  if (status === TaskStatus.RUNNING) return Math.max(current, incoming);
  if (status === TaskStatus.PENDING) return 0;
  return incoming;
}

function applyTaskUpdate(t: Task, payload: any): Task {
  if (payload.type === 'Progress') {
    return { ...t, progress: stabilizeProgress(t.progress, payload.payload.percent, t.status) };
  }
  if (payload.type === 'TaskSnapshot') {
    const snap = payload.payload;
    const nextStatus = snap.status ?? t.status;
    return {
      ...t,
      status: nextStatus,
      progress: stabilizeProgress(t.progress, snap.progress ?? t.progress, nextStatus),
      exitCode: snap.exitCode,
      errorMessage: snap.errorMessage,
      startedAt: parseTs(snap.startedAt) ?? t.startedAt,
      finishedAt: parseTs(snap.finishedAt) ?? t.finishedAt,
      updatedAt: parseTs(snap.updatedAt) ?? t.updatedAt,
    };
  }
  return t;
}

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
              .finally(() => { reconnectingTaskStreams.delete(streamKey); });
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
      if (frameId !== null) { window.cancelAnimationFrame(frameId); frameId = null; }
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
      return { ...next, progress: stabilizeProgress(prev.progress, next.progress, next.status) };
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
