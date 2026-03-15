import React from 'react';
import { useTranslation } from 'react-i18next';
import { Task, TaskStatus } from '../types';
import { toast } from 'sonner';
import { AlertOctagon, Clock, Info, Play, Square } from 'lucide-react';
import { useStartTask, useStopTask, useBackends } from '../hooks/use-scanner-api';
import * as api from '../lib/api';

import { TaskStatusBadge } from '../components/TaskStatusBadge';
import DashboardGrid from '../components/DashboardGrid';

interface TaskDetailProps {
  task: Task;
}

export const TaskDetail: React.FC<TaskDetailProps> = ({ task }) => {
  const { t } = useTranslation();
  const { mutate: startTask, isPending: isStarting } = useStartTask();
  const { mutate: stopTask, isPending: isStopping } = useStopTask();
  const { data: backends = [] } = useBackends();

  const handleStart = () => {
    if (task.backendId) startTask({ backendId: task.backendId, taskId: task.id });
  };

  const handleStop = () => {
    if (task.backendId) stopTask({ backendId: task.backendId, taskId: task.id });
  };

  const handleRestart = async () => {
    if (!task.backendId) return;
    const backend = backends.find(b => b.id === task.backendId);
    if (!backend?.address) return;

    try {
      const res = await api.restartScan(backend.address, task.id, !!backend.useTls);
      if (!res.ok) {
        toast.error(res.error || '重启任务失败');
        return;
      }

      // Optionally, startTask is not needed because server `restart_task` may start the task when `start_now=true`.
      toast.success(t('task_detail.restart_success'));

    } catch (e) {
      console.error(e);
    }
  };

  // Determine styles based on status
  const getProgressStyles = () => {
    switch (task.status) {
      case TaskStatus.DONE:
        return 'bg-green-500/20 text-green-400/20';
      case TaskStatus.FAILED:
        return 'bg-red-500/20 text-red-400/20';
      case TaskStatus.STOPPED:
        return 'bg-orange-500/20 text-orange-400/20';
      case TaskStatus.RUNNING:
        return 'bg-blue-500/20 text-blue-400/20';
      default:
        return 'bg-gray-500/10 text-gray-400/10';
    }
  };

  const isToggling = isStarting || isStopping;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="relative overflow-hidden p-6 border-b border-border bg-card/50 flex items-center justify-between transition-colors">
        {/* Progress Background with Binary Animation */}
        <div
          className={`absolute left-0 top-0 bottom-0 transition-all duration-700 ease-out pointer-events-none overflow-hidden ${getProgressStyles()}`}
          style={{ width: `${task.progress}%` }}
        >

        </div>

        <div className="relative z-10 max-w-2xl">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-2xl font-bold text-white truncate">{task.name}</h2>
            <TaskStatusBadge status={task.status} />
          </div>

          {task.description && (
            <p className="text-sm text-gray-400 mb-2 italic">"{task.description}"</p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground font-mono">
            <span className="flex items-center gap-1"><Clock size={12} /> {t('task_detail.created', { time: task.createdAt ? new Date(task.createdAt).toLocaleTimeString() : '-' })}</span>
            {task.finishedAt && (
              <span className="flex items-center gap-1 text-gray-300">
                {t('task_detail.end', { time: task.finishedAt ? new Date(task.finishedAt).toLocaleTimeString() : '-' })}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2 relative z-10 ml-4">
          {(task.status === TaskStatus.PENDING || task.status === TaskStatus.PAUSED) && (
            <button onClick={handleStart} disabled={isToggling} title={isToggling ? t('task_detail.processing') : ''} className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-semibold rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95">
              {isStarting ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : <Play size={16} fill="currentColor" />}
              {t('task_detail.start')}
            </button>
          )}

          {task.status === TaskStatus.RUNNING && (
            <button onClick={handleStop} disabled={isToggling} title={isToggling ? t('task_detail.processing') : ''} className="flex items-center gap-2 px-4 py-2 bg-red-900/50 text-red-200 border border-red-900 text-sm font-semibold rounded-md hover:bg-red-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95">
              {isStopping ? <span className="w-4 h-4 border-2 border-red-200/30 border-t-red-200 rounded-full animate-spin" /> : <Square size={16} fill="currentColor" />}
              {t('task_detail.stop')}
            </button>
          )}

          {(task.status === TaskStatus.DONE || task.status === TaskStatus.FAILED) && (
            <button onClick={handleRestart} disabled={isToggling} title={isToggling ? t('task_detail.processing') : t('task_detail.restart')} className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-semibold rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95">
              <Play size={16} fill="currentColor" /> {t('task_detail.restart')}
            </button>
          )}
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="flex-1 overflow-hidden flex flex-col md:flex-row">

        {/* Left: Metadata */}
        <div className="flex-1 flex flex-col border-r border-border min-w-0">
          {/* Info Panel */}
          <div className="p-3 bg-card border-b border-border flex flex-col gap-2">
            <div className="flex items-start gap-2 text-sm text-gray-300">
              <Info size={14} className="mt-0.5 text-blue-400" />
              {/* <div className="flex-1 break-all">
                <span className="font-semibold text-xs uppercase tracking-wide text-muted-foreground block mb-0.5">{t('task_detail.targets')}</span>
                {(task.targets ?? []).join(', ')}
              </div> */}
            </div>
            {(task.exitCode !== undefined || task.errorMessage) && (
              <div className="flex items-start gap-2 text-sm mt-1 p-2 rounded bg-black/20 border border-border">
                <AlertOctagon size={14} className="mt-0.5 text-red-400" />
                <div>
                  {task.exitCode !== undefined && <div className="text-gray-400 text-xs">{t('task_detail.exit_code', { code: task.exitCode })}</div>}
                  {task.errorMessage && <div className="text-red-300 font-mono">{task.errorMessage}</div>}
                </div>
              </div>
            )}
          </div>

          {/* Dashboard Grid */}
          <div className="flex-1 overflow-y-auto p-4 bg-black/10">
            <DashboardGrid results={task.results || []} />
          </div>
        </div>

      </div>
    </div>
  );
};

