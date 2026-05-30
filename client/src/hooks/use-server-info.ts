import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import { toast } from 'sonner';
import i18n from '../lib/i18n';
import { useBackends } from './use-backends';

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return String(err ?? 'Unknown error');
};

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

export function useSyncNucleiTemplates() {
  const queryClient = useQueryClient();
  const { data: backends } = useBackends();

  return useMutation({
    mutationFn: async (payload: {
      backendId: string;
      localPath?: string;
      repoUrl?: string;
      clearLocalPath?: boolean;
    }) => {
      const backend = backends?.find(b => b.id === payload.backendId);
      if (!backend?.address) throw new Error('Backend not found');
      const res = await api.syncNucleiTemplates(
        backend.address,
        { localPath: payload.localPath, repoUrl: payload.repoUrl, clearLocalPath: payload.clearLocalPath },
        !!backend.useTls,
      );
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['serverInfo', variables.backendId] });
      toast.success(i18n.t('toast.nuclei_sync_success', { defaultValue: 'Nuclei templates synced' }));
    },
    onError: (err) => {
      toast.error(i18n.t('toast.nuclei_sync_error', { defaultValue: 'Nuclei templates sync failed: {{message}}', message: getErrorMessage(err) }));
    },
  });
}
