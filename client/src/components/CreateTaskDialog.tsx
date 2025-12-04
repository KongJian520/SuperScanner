import React from 'react';
import { CreateTask } from '@/views/CreateTask';
import { useNavigate } from 'react-router-dom';
import { BackendConfig, Task } from '@/types';

interface Props {
  availableBackends: BackendConfig[];
  onSubmit: (payload: { name: string; description?: string; targets: string[]; backendId?: string | null; options?: Record<string, any> }) => Promise<{ ok: boolean; data?: Task; error?: string }>;
  isSubmitting?: boolean;
  error?: string | null;
}

export const CreateTaskDialog: React.FC<Props> = ({ availableBackends, onSubmit, isSubmitting, error }) => {
  const navigate = useNavigate();
  const handleCancel = () => navigate('/tasks');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleCancel} />
      <div className="relative z-10 w-full max-w-3xl bg-card rounded-lg shadow-lg p-6">
        <CreateTask availableBackends={availableBackends} onSubmit={onSubmit} onCancel={handleCancel} isSubmitting={isSubmitting} error={error} />
      </div>
    </div>
  );
};

export default CreateTaskDialog;
