import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Server } from 'lucide-react';
import { useBackends, useDeleteBackend } from '../hooks/use-scanner-api';
import { useAppStore } from '../lib/store';

export const ServersOverview: React.FC = () => {
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
          <Server />
          <h2 className="text-xl font-bold">Servers</h2>
        </div>
        <div>
          <button onClick={() => navigate('/servers/new')} className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-500 transition-colors">Add Backend</button>
        </div>
      </div>

      {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading backends...</div>
      ) : backends.length === 0 ? (
        <div className="text-sm text-muted-foreground">No backends configured.</div>
      ) : (
        <div className="space-y-2">
          {backends.map((b, idx) => (
            <div key={b.id ?? `${b.name}-${idx}`} className="flex items-center justify-between p-3 bg-card rounded-md cursor-pointer hover:bg-accent transition-colors" onClick={() => handleSelectBackend(b.id)}>
              <div>
                <div className="font-semibold">{b.name}</div>
                <div className="text-xs text-muted-foreground">{b.address ?? b.name}</div>
              </div>
              <div>
                <button onClick={(e) => handleDeleteBackend(b.id ?? `${b.name}-${idx}`, e)} className="text-sm text-red-400 hover:text-red-300">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ServersOverview;
