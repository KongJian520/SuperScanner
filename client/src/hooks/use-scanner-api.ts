import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import * as api from '../lib/api';
import { Task, LogEntry, TaskStatus } from '../types';
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
      
      // Smart Merge: Preserve local state (logs, progress) that might be newer than DB
      const oldTasks = queryClient.getQueryData<Task[]>(['tasks', backendId]);
      if (!oldTasks) return newTasks;

      return newTasks.map(nt => {
          const ot = oldTasks.find(t => t.id === nt.id);
          if (!ot) return nt;

          // If task is running/pending, preserve progress if local is ahead
          // Also preserve logs since listTasks returns empty logs
          if (nt.status === TaskStatus.RUNNING || nt.status === TaskStatus.PENDING) {
              return {
                  ...nt,
                  progress: Math.max(nt.progress, ot.progress),
                  logs: (ot.logs?.length ?? 0) > (nt.logs?.length ?? 0) ? ot.logs : nt.logs,
              };
          }
          // Even if done, we might want to keep logs if listTasks doesn't return them
          if (nt.status === TaskStatus.DONE || nt.status === TaskStatus.FAILED || nt.status === TaskStatus.STOPPED) {
               return {
                   ...nt,
                   logs: (ot.logs?.length ?? 0) > (nt.logs?.length ?? 0) ? ot.logs : nt.logs,
               };
          }
          
          return nt;
      });
    },
    enabled: !!backend?.address,
    staleTime: 5000, // Cache for 5 seconds
    refetchInterval: 10000, // Auto-refresh every 10s
  });
}

export function useTaskEvents(backendId: string | null, taskId: string | null) {
    const { data: backends } = useBackends();
    const backend = backends?.find((b) => b.id === backendId);
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!backend?.address || !taskId) return;

        let unlisten: (() => void) | undefined;

        const startListening = async () => {
            // Start the stream on the backend
            if (backend?.address) {
                await api.streamTaskEvents(backend.address, taskId, !!backend.useTls);
            }

            // Listen for events
            unlisten = await listen(`task-event://${taskId}`, (event: any) => {
                const payload = event.payload;
                
                queryClient.setQueryData(['tasks', backendId], (oldTasks: Task[] | undefined) => {
                    if (!oldTasks) return oldTasks;
                    return oldTasks.map(t => {
                        if (t.id !== taskId) return t;
                        
                        // Update task based on event type
                        if (payload.type === 'Progress') {
                            return { ...t, progress: payload.payload.percent };
                        } else if (payload.type === 'Log') {
                            const logEntry: LogEntry = {
                                id: Date.now().toString() + Math.random(), // simple unique id
                                timestamp: payload.payload.ts ? Date.parse(payload.payload.ts) : Date.now(),
                                level: payload.payload.is_stderr ? 'error' : 'info',
                                message: payload.payload.text,
                                source: payload.payload.subtask
                            };
                            return { ...t, logs: [...(t.logs || []), logEntry] };
                        } else if (payload.type === 'TaskSnapshot') {
                            // Merge snapshot data
                            const snap = payload.payload;
                            
                            // Calculate new progress
                            // Use snapshot progress if available, but prefer local progress if snapshot is stale (0) while running
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
                                ...snap, // Update basic fields
                                status: snap.status,
                                progress: newProgress,
                                startedAt: snap.started_at ? parseTs(snap.started_at) : t.startedAt,
                                finishedAt: snap.finished_at ? parseTs(snap.finished_at) : t.finishedAt,
                            };
                        }
                        return t;
                    });
                });
            });
        };

        startListening();

        return () => {
            if (unlisten) unlisten();
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
        refetchInterval: 2000, // Faster refresh for details (logs)
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
      targets: string[] 
    }) => {
      const backend = backends?.find(b => b.id === payload.backendId);
      if (!backend?.address) throw new Error('Backend not found');

      const res = await api.createScanTask(
        backend.address, 
        { name: payload.name, description: payload.description, targets: payload.targets }, 
        !!backend.useTls
      );
      if (!res.ok) throw new Error(res.error);
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
      // Optimistically update status to RUNNING
      queryClient.setQueryData(['tasks', variables.backendId], (oldTasks: Task[] | undefined) => {
          if (!oldTasks) return oldTasks;
          return oldTasks.map(t => t.id === variables.taskId ? { ...t, status: TaskStatus.RUNNING } : t);
      });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.backendId] });
      toast.success('任务已启动');
    },
    onError: (err) => toast.error(`启动失败: ${err.message}`),
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
    onError: (err) => toast.error(`停止失败: ${err.message}`),
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
