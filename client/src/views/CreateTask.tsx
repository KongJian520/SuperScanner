import React, {useState} from 'react';
import {BackendConfig, Task} from '../types';
import {Box} from 'lucide-react';

interface CreateTaskProps {
  availableBackends: BackendConfig[];
  onSubmit: (payload: { name: string; description?: string; targets: string[]; backendId?: string | null; options?: Record<string, any> }) => Promise<{ ok: boolean; data?: Task; error?: string }>;
  onCancel: () => void;
  isSubmitting?: boolean;
  error?: string | null;
}

export const CreateTask: React.FC<CreateTaskProps> = ({ availableBackends, onSubmit, onCancel, isSubmitting }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetString, setTargetString] = useState('');

  const [selectedBackendId, setSelectedBackendId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetString) return;

    const targets = targetString.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    if (targets.length === 0) return;

    const selectedBackend = availableBackends.find(b => b.id === selectedBackendId);
    const payload = {
      name: name || `Scan ${targets[0]}`,
      description,
      targets,
      backendId: selectedBackend?.id,
      options: {
        timeout: 5000,
        aggressive: true,
      },
    };

    try {
      await onSubmit(payload);
    } catch (e) {
      console.error('CreateTask onSubmit error', e);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-8">
        <div className="w-full max-w-xl space-y-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white">New Scan</h2>
            <p className="text-muted-foreground mt-2">Configure targets and select the scanning engine.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="text-sm font-medium text-gray-300">Task Name (Optional)</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Security Scan"
                  className="w-full mt-1 bg-input border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-sm font-medium text-gray-300">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Context about this scan operation..."
                  rows={2}
                  className="w-full mt-1 bg-input border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all resize-none"
                />
              </div>

              {/* Targets */}
              <div>
                <label className="text-sm font-medium text-gray-300">Targets (IPs / Hostnames)</label>
                <input
                  type="text"
                  value={targetString}
                  onChange={(e) => setTargetString(e.target.value)}
                  placeholder="e.g., 192.168.1.1, example.com"
                  className="w-full mt-1 bg-input border border-border rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground mt-1">Separate multiple targets with commas.</p>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <label className="text-sm font-medium text-gray-300">Select Backend Engine</label>

              {availableBackends.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 max-h-40 overflow-y-auto">
                  {availableBackends.map((backend, idx) => (
                    <div
                      key={backend.id ?? `${backend.name}-${idx}`}
                      onClick={() => setSelectedBackendId(backend.id)}
                      className={`
                                cursor-pointer p-3 rounded-lg border transition-all flex items-center gap-3
                                ${selectedBackendId === backend.id
                          ? 'bg-blue-500/10 border-blue-500/50 shadow-[0_0_0_1px_rgba(59,130,246,0.5)]'
                          : 'bg-secondary/50 border-border hover:bg-secondary'}
                            `}
                    >
                      <div className={`p-2 rounded bg-black/20 ${selectedBackendId === backend.id ? 'text-blue-400' : 'text-gray-400'}`}>
                        <Box size={20} />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-white">{backend.name}</div>
                      </div>
                      {selectedBackendId === backend.id && (
                        <div className="w-2 h-2 rounded-full bg-blue-500 mr-2" />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 bg-secondary/50 rounded-lg text-sm text-muted-foreground">
                  No backend engines available. Please add a backend first.
                </div>
              )}
            </div>

            <div className="pt-4 flex items-center gap-4">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={(isSubmitting ?? false) || !targetString}
                className={`
                flex-1 bg-white text-black py-2.5 rounded-lg font-semibold text-sm transition-all
                ${(isSubmitting ?? false) || !targetString ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-200 active:scale-[0.98]'}
              `}
              >
                {(isSubmitting ?? false) ? 'Creating...' : 'Initialize Task'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
