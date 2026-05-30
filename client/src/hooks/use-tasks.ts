import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import { Task, TaskStatus } from '../types';
import { toast } from 'sonner';
import i18n from '../lib/i18n';
import { useBackends } from './use-backends';

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return String(err ?? 'Unknown error');
};

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
