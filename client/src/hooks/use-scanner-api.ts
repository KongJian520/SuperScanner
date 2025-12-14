import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import { BackendConfig, Task } from '../types';
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

  return useQuery({
    queryKey: ['tasks', backendId],
    queryFn: async () => {
      if (!backend?.address) throw new Error('Backend address not found');
      const res = await api.listTasks(backend.address, !!backend.useTls);
      if (!res.ok) throw new Error(res.error);
      // Attach backendId to tasks for context
      return res.data.map(t => ({ ...t, backendId: backend.id }));
    },
    enabled: !!backend?.address,
    staleTime: 5000, // Cache for 5 seconds
    refetchInterval: 10000, // Auto-refresh every 10s
  });
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
             // If there is no specific getTask, we might have to list all. 
             // Ideally we should add `getTask` to api.ts if it exists in Rust.
             // For now, let's reuse listTasks and find.
             const res = await api.listTasks(backend.address, !!backend.useTls);
             if (!res.ok) throw new Error(res.error);
             const task = res.data.find(t => t.id === taskId);
             if (!task) throw new Error('Task not found');
             return { ...task, backendId: backend.id };
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
    onSuccess: (data, variables) => {
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
      const res = await api.getServerInfo(backend.address);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: !!backend?.address,
    refetchInterval: 10000,
  });
}
