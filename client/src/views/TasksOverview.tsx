import React from 'react';
import { useNavigate } from 'react-router-dom';
import { List } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { useTasks, useDeleteTask, useBackends } from '../hooks/use-scanner-api';
import { TaskStatus } from '../types';
import { TaskStatusBadge } from '../components/TaskStatusBadge';

export const TasksOverview: React.FC = () => {
  const navigate = useNavigate();
  const { activeBackendId, setActiveTaskId, setActiveBackendId } = useAppStore();
  const { data: backends } = useBackends();
  
  const effectiveBackendId = activeBackendId ?? backends?.find(b => b.address)?.id ?? null;
  const { data: tasks = [], isLoading } = useTasks(effectiveBackendId);
  const { mutate: deleteTask } = useDeleteTask();

  const handleSelectTask = (id: string) => {
    setActiveTaskId(id);
    setActiveBackendId(null);
    navigate(`/task/${id}`);
  };

  const handleDeleteTask = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (effectiveBackendId) {
        deleteTask({ backendId: effectiveBackendId, taskId: id });
    }
  };

  const getProgressStyles = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.DONE:
        return 'bg-green-500/20';
      case TaskStatus.FAILED:
        return 'bg-red-500/20';
      case TaskStatus.STOPPED:
        return 'bg-orange-500/20';
      case TaskStatus.RUNNING:
        return 'bg-blue-500/20';
      default:
        return 'bg-gray-500/10';
    }
  };

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <List />
          <h2 className="text-xl font-bold">Tasks</h2>
        </div>
        <div>
          <button onClick={() => navigate('/tasks/new')} className="px-3 py-2 bg-white text-black rounded-md">New Task</button>
        </div>
      </div>

      {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="text-sm text-muted-foreground">No tasks yet. Create one to get started.</div>
      ) : (
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.id} className="relative overflow-hidden flex items-center justify-between p-3 bg-card rounded-md cursor-pointer hover:bg-accent transition-colors group" onClick={() => handleSelectTask(t.id)}>
              {/* Progress Bar Background */}
              <div
                  className={`absolute left-0 top-0 bottom-0 transition-all duration-500 ease-out pointer-events-none ${getProgressStyles(t.status)}`}
                  style={{ width: `${t.progress}%` }}
              />

              <div className="relative z-10 flex items-center gap-4">
                <div>
                    <div className="font-semibold flex items-center gap-2">
                        {t.name}
                        <TaskStatusBadge status={t.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">{(t.targets?.length ?? 0)} targets</div>
                </div>
              </div>
              <div className="relative z-10">
                <button onClick={(e) => handleDeleteTask(t.id, e)} className="text-sm text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TasksOverview;
