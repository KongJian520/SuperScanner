import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import * as api from '../lib/api';
import { Task, TaskStatus } from '../types';
import { toast } from 'sonner';

// --- Backends ---

export function useBackends() {
  return useQuery({
    queryKey: ['backends'],
    queryFn: async () => {
      const res = await api.getBackends();
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
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
      toast.success('后端添加成功');
    },
    onError: (err) => {
      toast.error(`添加后端失败: ${err.message}`);
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
      toast.success('后端已删除');
    },
    onError: (err) => {
      toast.error(`删除后端失败: ${err.message}`);
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
      console.log('[Hooks] useTasks fetching for backend:', backendId);
      const res = await api.listTasks(backend.address, !!backend.useTls);
      if (!res.ok) throw new Error(res.error);

      const newTasks = res.data.map(t => ({ ...t, backendId: backend.id }));
      console.log('[Hooks] useTasks fetched count:', newTasks.length);

      // Smart Merge: Preserve local state (logs, progress) that might be newer than DB
      const oldTasks = queryClient.getQueryData<Task[]>(['tasks', backendId]);
      if (!oldTasks) return newTasks;

      return newTasks.map(nt => {
        const ot = oldTasks.find(t => t.id === nt.id);
        if (!ot) return nt;

        // If task is running/pending, preserve progress if local is ahead
        // Also preserve logs since listTasks returns empty logs
        if (nt.status === TaskStatus.RUNNING || nt.status === TaskStatus.PENDING) {
          const preservedProgress = Math.max(nt.progress, ot.progress);
          if (preservedProgress !== nt.progress) {
            console.log(`[Hooks] useTasks preserving progress for ${nt.id}: API=${nt.progress}, Local=${ot.progress}`);
          }
          return {
            ...nt,
            progress: preservedProgress,
          };
        }
        // Even if done, we might want to keep logs if listTasks doesn't return them
        if (nt.status === TaskStatus.DONE || nt.status === TaskStatus.FAILED || nt.status === TaskStatus.STOPPED) {
          return nt;
        }

        return nt;
      });
    },
    enabled: !!backend?.address,
    staleTime: 5000, // Cache for 5 seconds
    refetchInterval: 10000, // Auto-refresh every 10s
  });
}

// Helper to apply event updates to a task
function applyTaskUpdate(t: Task, payload: any): Task {
  if (payload.type === 'Progress') {
    return { ...t, progress: payload.payload.percent };
  } else if (payload.type === 'TaskSnapshot') {
    const snap = payload.payload;
    let newProgress = snap.progress ?? t.progress;
    if (snap.status === TaskStatus.RUNNING && newProgress === 0 && t.progress > 0) {
      newProgress = t.progress;
    }
    if (snap.status === TaskStatus.DONE) {
      newProgress = 100;
    } else if (snap.status === TaskStatus.PENDING) {
      newProgress = 0;
    }
    const parseTs = (ts: any) => typeof ts === 'string' ? Date.parse(ts) : (typeof ts === 'number' ? ts : undefined);
    return {
      ...t,
      status: snap.status,
      progress: newProgress,
      exitCode: snap.exit_code,
      errorMessage: snap.error_message,
      startedAt: snap.started_at ? parseTs(snap.started_at) : t.startedAt,
      finishedAt: snap.finished_at ? parseTs(snap.finished_at) : t.finishedAt,
      updatedAt: snap.updated_at ? parseTs(snap.updated_at) : t.updatedAt,
    };
  }
  return t;
}

// Global map to avoid attaching multiple Tauri listeners / streams for the same task
type ActiveListener = { count: number; unlisten?: () => void; removed?: boolean };
const activeTaskListeners: Map<string, ActiveListener> = new Map();
// Simple counter to give each listener instance a unique id for diagnostics
let __listenerInstanceCounter = 0;

export function useTaskEvents(backendId: string | null, taskId: string | null) {
  const { data: backends } = useBackends();
  const backend = backends?.find((b) => b.id === backendId);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!backend?.address || !taskId) return;

    let _localRemoved = false;

    const startListening = async () => {
      const myListenerInstance = ++__listenerInstanceCounter;
      console.log('[Hooks] useTaskEvents startListening', { taskId, backend: backend?.address, listenerInstance: myListenerInstance });
      // If there's already an active listener for this task, just increment refcount
      const existing = activeTaskListeners.get(taskId);
      if (existing) {
        existing.count += 1;
        console.log('[Hooks] useTaskEvents existing listener - incremented count', { taskId, count: existing.count, listenerInstance: myListenerInstance });
        return;
      }

      // Reserve an entry immediately to avoid races from concurrent mounts
      activeTaskListeners.set(taskId, { count: 1, unlisten: undefined, removed: false });
      console.log('[Hooks] useTaskEvents reserved listener entry', { taskId, listenerInstance: myListenerInstance });

      // Start the stream on the backend (spawn background tauri task that emits events)
      try {
        await api.streamTaskEvents(backend.address!, taskId, !!backend.useTls);
        console.log('[Hooks] useTaskEvents streamTaskEvents started', { taskId, listenerInstance: myListenerInstance });
      } catch (e) {
        // stream start failed; cleanup reservation
        const cur = activeTaskListeners.get(taskId);
        if (cur && cur.count <= 1) activeTaskListeners.delete(taskId);
        console.error('[Hooks] useTaskEvents streamTaskEvents failed to start', { taskId, err: e, listenerInstance: myListenerInstance });
        return;
      }

      // Register a single global listener for this task id
      const unlisten = await listen(`task-event://${taskId}`, (event: any) => {
        const payload = event.payload;
        try {
          console.log('[Hooks] useTaskEvents event received', { taskId, listenerInstance: myListenerInstance, type: payload?.type, payloadSummary: typeof payload === 'string' ? payload.slice(0, 200) : (payload && payload.payload ? (payload.payload.text ? payload.payload.text.slice(0, 200) : JSON.stringify(payload.payload).slice(0, 200)) : JSON.stringify(payload).slice(0, 200)) });
        } catch (e) {
          console.warn('[Hooks] useTaskEvents failed to summarize payload', { err: e });
        }

        queryClient.setQueryData(['tasks', backendId], (oldTasks: Task[] | undefined) => {
          if (!oldTasks) return oldTasks;
          return oldTasks.map(t => {
            if (t.id !== taskId) return t;
            return applyTaskUpdate(t, payload);
          });
        });

        // Also update single task cache
        queryClient.setQueryData(['task', backendId, taskId], (oldTask: Task | undefined) => {
          if (!oldTask) return oldTask;
          return applyTaskUpdate(oldTask, payload);
        });
      });

      // If unmounted while we were starting, honor immediate removal
      const cur = activeTaskListeners.get(taskId);
      if (cur) {
        cur.unlisten = unlisten;
        if (cur.removed) {
          // someone already requested removal; cleanup now
          if (cur.unlisten) cur.unlisten();
          console.log('[Hooks] useTaskEvents cleaned up immediately due to prior remove', { taskId, listenerInstance: myListenerInstance });
          activeTaskListeners.delete(taskId);
        } else {
          // Store the unlisten function for later cleanup
          cur.unlisten = unlisten;
        }
      }
    };

    startListening();

    return () => {
      // Decrement refcount and cleanup when reaches zero
      const existing = activeTaskListeners.get(taskId);
      if (existing) {
        existing.count -= 1;
        console.log('[Hooks] useTaskEvents cleanup called - decremented count', { taskId, newCount: existing.count });
        if (existing.count <= 0) {
          console.log('[Hooks] useTaskEvents cleanup removing listener', { taskId });
          if (existing.unlisten) existing.unlisten();
          activeTaskListeners.delete(taskId);
        }
      }
      localRemoved = true;
    };
  }, [backend?.address, backend?.useTls, taskId, queryClient, backendId]);
}

export function useTaskDetail(backendId: string | null, taskId: string | null) {
  const { data: backends } = useBackends();
  const backend = backends?.find((b) => b.id === backendId);

  // We can't easily fetch a single task detail if the API doesn't support it directly 
  // or if we want to reuse the list. 
  // Assuming we might want to fetch fresh details or just use the list cache.
  // For now, let's assume we fetch the list and find the task, 
  // OR if there is a specific getTask API (not visible in api.ts snippet), use that.
  // The snippet showed `listTasks`. 
  // If we need real-time details (logs etc), we might need a specific call.
  // But `listTasks` returns `Task[]`.

  // Actually, for detailed view (logs), we usually need a separate call if the list is summary only.
  // But `Task` type has `logs`. If `listTasks` returns full objects, we are fine.
  // If not, we might need `getTask`.
  // Let's assume `listTasks` is enough for now, or we filter from `useTasks`.

  return useQuery({
    queryKey: ['task', backendId, taskId],
    queryFn: async () => {
      if (!backend?.address || !taskId) throw new Error('Invalid context');

      const res = await api.getTask(backend.address, taskId, !!backend.useTls);
      if (!res.ok) throw new Error(res.error);
      return { ...res.data, backendId: backend.id };
    },
    enabled: !!backend?.address && !!taskId,
    // Smart Polling: 
    // 1. Rely primarily on useTaskEvents for real-time updates.
    // 2. Poll every 5s as a backup if task is running.
    // 3. Stop polling if task is finished.
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
      console.log('[Hooks] useCreateTask called', payload);
      const backend = backends?.find(b => b.id === payload.backendId);
      if (!backend?.address) throw new Error('Backend not found');

      const res = await api.createScanTask(
        backend.address,
        {
          name: payload.name,
          description: payload.description,
          targets: payload.targets,
          workflow: payload.workflow
        },
        !!backend.useTls
      );
      if (!res.ok) throw new Error(res.error);
      console.log('[Hooks] useCreateTask success:', res.data);
      return { ...res.data, backendId: backend.id };
    },
    onSuccess: (_data, variables) => {
      // Optimistically update the cache to include the new task immediately
      queryClient.setQueryData(['tasks', variables.backendId], (oldTasks: Task[] | undefined) => {
        if (!oldTasks) return [_data];
        return [...oldTasks, _data];
      });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.backendId] });
      toast.success('任务创建成功');
    },
    onError: (err) => {
      console.error('[Hooks] useCreateTask error:', err);
      toast.error(`创建任务失败: ${err.message}`);
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  const { data: backends } = useBackends();

  return useMutation({
    mutationFn: async (payload: { backendId: string; taskId: string }) => {
      console.log('[Hooks] useDeleteTask called', payload);
      const backend = backends?.find(b => b.id === payload.backendId);
      if (!backend?.address) throw new Error('Backend not found');

      const res = await api.deleteTask(backend.address, payload.taskId, !!backend.useTls);
      if (!res.ok) throw new Error(res.error);
      console.log('[Hooks] useDeleteTask success');
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.backendId] });
      toast.success('任务已删除');
    },
    onError: (err) => {
      console.error('[Hooks] useDeleteTask error:', err);
      toast.error(`删除任务失败: ${err.message}`);
    },
  });
}

export function useStartTask() {
  const queryClient = useQueryClient();
  const { data: backends } = useBackends();

  return useMutation({
    mutationFn: async (payload: { backendId: string; taskId: string }) => {
      console.log('[Hooks] useStartTask called', payload);
      const backend = backends?.find(b => b.id === payload.backendId);
      if (!backend?.address) throw new Error('Backend not found');
      const res = await api.startScan(backend.address, payload.taskId, !!backend.useTls);
      if (!res.ok) throw new Error(res.error);
      console.log('[Hooks] useStartTask success');
      return res.data;
    },
    onSuccess: (_, variables) => {
      // Optimistically update status to RUNNING
      queryClient.setQueryData(['tasks', variables.backendId], (oldTasks: Task[] | undefined) => {
        if (!oldTasks) return oldTasks;
        return oldTasks.map(t => t.id === variables.taskId ? { ...t, status: TaskStatus.RUNNING } : t);
      });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.backendId] });
      toast.success('任务已启动');
    },
    onError: (err) => {
      console.error('[Hooks] useStartTask error:', err);
      toast.error(`启动失败: ${err.message}`);
    },
  });
}

export function useStopTask() {
  const queryClient = useQueryClient();
  const { data: backends } = useBackends();

  return useMutation({
    mutationFn: async (payload: { backendId: string; taskId: string }) => {
      console.log('[Hooks] useStopTask called', payload);
      const backend = backends?.find(b => b.id === payload.backendId);
      if (!backend?.address) throw new Error('Backend not found');
      const res = await api.stopScan(backend.address, payload.taskId, !!backend.useTls);
      if (!res.ok) throw new Error(res.error);
      console.log('[Hooks] useStopTask success');
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.backendId] });
      toast.success('任务已停止');
    },
    onError: (err) => {
      console.error('[Hooks] useStopTask error:', err);
      toast.error(`停止失败: ${err.message}`);
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
