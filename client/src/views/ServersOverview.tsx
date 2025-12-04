import React from 'react';
import { BackendConfig } from '@/types';
import { useNavigate } from 'react-router-dom';
import { Server } from 'lucide-react';

interface Props {
  backends: BackendConfig[];
  onSelectBackend: (id: string) => void;
  onDeleteBackend: (id: string, e: React.MouseEvent) => void;
  onNewBackend: () => void;
}

export const ServersOverview: React.FC<Props> = ({ backends, onSelectBackend, onDeleteBackend}) => {
  const navigate = useNavigate();

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Server />
          <h2 className="text-xl font-bold">Servers</h2>
        </div>
        <div>
          <button onClick={() => navigate('/servers/new')} className="px-3 py-2 bg-blue-600 text-white rounded-md">Add Backend</button>
        </div>
      </div>

      {backends.length === 0 ? (
        <div className="text-sm text-muted-foreground">No backends configured.</div>
      ) : (
        <div className="space-y-2">
          {backends.map((b, idx) => (
            <div key={b.id ?? `${b.name}-${idx}`} className="flex items-center justify-between p-3 bg-card rounded-md cursor-pointer" onClick={() => onSelectBackend(b.id)}>
              <div>
                <div className="font-semibold">{b.name}</div>
                <div className="text-xs text-muted-foreground">{b.address ?? b.name}</div>
              </div>
              <div>
                <button onClick={(e) => onDeleteBackend(b.id ?? `${b.name}-${idx}`, e)} className="text-sm text-red-400">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ServersOverview;
