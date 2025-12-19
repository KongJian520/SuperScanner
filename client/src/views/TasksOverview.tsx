import React from 'react';
import { useNavigate } from 'react-router-dom';
import { List as ListIcon } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { useTasks, useDeleteTask, useBackends } from '../hooks/use-scanner-api';
import { TaskStatus } from '../types';
import { TaskStatusBadge } from '../components/TaskStatusBadge';
import { FixedSizeList as ListWindow, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useTranslation } from 'react-i18next';

export const TasksOverview: React.FC = () => {
  const { t } = useTranslation();
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

  const Row = ({ index, style }: ListChildComponentProps) => {
    const task = tasks[index];
    return (
      <div style={style} className="px-1 py-1">
        <div
          className="relative overflow-hidden flex items-center justify-between p-3 bg-card rounded-md cursor-pointer hover:bg-accent transition-colors group h-full"
          onClick={() => handleSelectTask(task.id)}
        >
          {/* Progress Bar Background */}
          <div
            className={`absolute left-0 top-0 bottom-0 transition-all duration-500 ease-out pointer-events-none ${getProgressStyles(task.status)}`}
            style={{ width: `${task.progress}%` }}
          />

          <div className="relative z-10 flex items-center gap-4">
            <div>
              <div className="font-semibold flex items-center gap-2">
                {task.name}
                <TaskStatusBadge status={task.status} />
              </div>
              <div className="text-xs text-muted-foreground">
                {t('sidebar.targets', { count: task.targets?.length ?? 0 })}
              </div>
            </div>
          </div>
          <div className="relative z-10">
            <button onClick={(e) => handleDeleteTask(task.id, e)} className="text-sm text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity">
              {t('common.delete')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <ListIcon />
          <h2 className="text-xl font-bold">{t('sidebar.tasks')}</h2>
        </div>
        <div>
          <button onClick={() => navigate('/tasks/new')} className="px-3 py-2 bg-white text-black rounded-md">
            {t('sidebar.new_task')}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t('tasks.loading')}</div>
        ) : tasks.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t('tasks.empty')}</div>
        ) : (
          <AutoSizer>
            {({ height, width }) => (
              <ListWindow
                height={height}
                itemCount={tasks.length}
                itemSize={80}
                width={width}
              >
                {Row}
              </ListWindow>
            )}
          </AutoSizer>
        )}
      </div>
    </div>
  );
};

export default TasksOverview;
