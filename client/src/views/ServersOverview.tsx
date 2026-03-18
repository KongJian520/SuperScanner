import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Server, Wifi, WifiOff } from 'lucide-react';
import { useBackends, useDeleteBackend } from '../hooks/use-scanner-api';
import { useAppStore } from '../lib/store';

export const ServersOverview: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setActiveBackendId, setActiveTaskId } = useAppStore();
  const { data: backends = [], isLoading } = useBackends();
  const { mutate: deleteBackend } = useDeleteBackend();

  const handleSelectBackend = (id: string) => {
    setActiveBackendId(id);
    setActiveTaskId(null);
    navigate(`/server/${id}`);
  };

  const handleDeleteBackend = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteBackend(id);
  };

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Server size={20} className="text-muted-foreground" />
          <h2 className="text-xl font-bold text-foreground">{t('servers.title')}</h2>
        </div>
        <button
          onClick={() => navigate('/servers/new')}
          className="px-3 py-1.5 bg-primary text-primary-foreground text-sm font-semibold rounded-md hover:opacity-90 transition-opacity"
        >
          {t('servers.add')}
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-card animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
          ))}
        </div>
      ) : backends.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-lg text-sm">
          {t('servers.no_backends')}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {backends.map((b, idx) => (
            <div
              key={b.id ?? `${b.name}-${idx}`}
              className="group relative flex items-center gap-4 p-4 bg-card border border-border rounded-lg cursor-pointer hover:bg-accent hover:border-primary/30 transition-all"
              onClick={() => handleSelectBackend(b.id)}
            >
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20 flex-shrink-0">
                <Server size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-foreground truncate">{b.name}</div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                  {b.address ? (
                    <><Wifi size={10} className="text-green-500" /><span className="font-mono truncate">{b.address}</span></>
                  ) : (
                    <><WifiOff size={10} /><span>{t('servers.no_address')}</span></>
                  )}
                </div>
              </div>
              <button
                onClick={(e) => handleDeleteBackend(b.id ?? `${b.name}-${idx}`, e)}
                className="text-xs text-destructive opacity-0 group-hover:opacity-100 transition-opacity hover:underline flex-shrink-0"
              >
                {t('servers.delete')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ServersOverview;
