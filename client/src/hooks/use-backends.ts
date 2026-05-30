import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import { BackendConfig } from '../types';
import { toast } from 'sonner';
import i18n from '../lib/i18n';

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return String(err ?? 'Unknown error');
};

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
