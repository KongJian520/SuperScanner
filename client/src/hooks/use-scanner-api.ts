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
      const res = await api.listTasks(backend.address, !!backend.useTls);
      if (!res.ok) throw new Error(res.error);

      const newTasks = res.data.map(t => ({ ...t, backendId: backend.id }));

      // Smart Merge: 保留本地进度（可能比 DB 更新）
      const oldTasks = queryClient.getQueryData<Task[]>(['tasks', backendId]);
      if (!oldTasks) return newTasks;

      return newTasks.map(nt => {
        const ot = oldTasks.find(t => t.id === nt.id);
        if (!ot) return nt;
        if (nt.status === TaskStatus.RUNNING || nt.status === TaskStatus.PENDING) {
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

// Helper to apply event updates to a task
function applyTaskUpdate(t: Task, payload: any): Task {
  if (payload.type === 'Progress') {
    return { ...t, progress: payload.payload.percent };
  }
  if (payload.type === 'TaskSnapshot') {
    const snap = payload.payload;
    let newProgress = snap.progress ?? t.progress;
    if (snap.status === TaskStatus.RUNNING && newProgress === 0 && t.progress > 0) {
      newProgress = t.progress;
    } else if (snap.status === TaskStatus.DONE) {
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

// Global map to avoid attaching multiple Tauri listeners for the same task
type ActiveListener = { count: number; unlisten?: () => void; removed?: boolean };
const activeTaskListeners: Map<string, ActiveListener> = new Map();

export function useTaskEvents(backendId: string | null, taskId: string | null) {
  const { data: backends } = useBackends();
  const backend = backends?.find((b) => b.id === backendId);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!backend?.address || !taskId) return;

    let localRemoved = false;

    const startListening = async () => {
      const existing = activeTaskListeners.get(taskId);
      if (existing) {
        existing.count += 1;
        return;
      }

      // Reserve entry immediately to avoid races from concurrent mounts
      activeTaskListeners.set(taskId, { count: 1, unlisten: undefined, removed: false });

      try {
        await api.streamTaskEvents(backend.address!, taskId, !!backend.useTls);
      } catch {
        const cur = activeTaskListeners.get(taskId);
        if (cur && cur.count <= 1) activeTaskListeners.delete(taskId);
        return;
      }

      const unlisten = await listen(`task-event://${taskId}`, (event: any) => {
        const payload = event.payload;

        queryClient.setQueryData(['tasks', backendId], (oldTasks: Task[] | undefined) => {
          if (!oldTasks) return oldTasks;
          return oldTasks.map(t => t.id !== taskId ? t : applyTaskUpdate(t, payload));
        });

        queryClient.setQueryData(['task', backendId, taskId], (oldTask: Task | undefined) => {
          if (!oldTask) return oldTask;
          return applyTaskUpdate(oldTask, payload);
        });
      });

      const cur = activeTaskListeners.get(taskId);
      if (cur) {
        cur.unlisten = unlisten;
        if (cur.removed) {
          unlisten();
          activeTaskListeners.delete(taskId);
        }
      }
    };

    startListening();

    return () => {
      localRemoved = true;
      const existing = activeTaskListeners.get(taskId);
      if (existing) {
        existing.count -= 1;
        if (existing.count <= 0) {
          if (existing.unlisten) existing.unlisten();
          activeTaskListeners.delete(taskId);
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

  return useQuery({
    queryKey: ['task', backendId, taskId],
    queryFn: async () => {
      if (!backend?.address || !taskId) throw new Error('Invalid context');
      const res = await api.getTask(backend.address, taskId, !!backend.useTls);
      if (!res.ok) throw new Error(res.error);
      return { ...res.data, backendId: backend.id };
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
      toast.success('任务创建成功');
    },
    onError: (err) => {
      toast.error(`创建任务失败: ${err.message}`);
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
      toast.success('任务已删除');
    },
    onError: (err) => {
      toast.error(`删除任务失败: ${err.message}`);
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
      toast.success('任务已启动');
    },
    onError: (err) => {
      toast.error(`启动失败: ${err.message}`);
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
      toast.success('任务已停止');
    },
    onError: (err) => {
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
