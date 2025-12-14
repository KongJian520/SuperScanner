import React, {useEffect, useRef} from 'react';
import {Task, TaskStatus} from '../types';
import {toast} from 'sonner';
import {AlertOctagon, CheckCircle2, Clock, Download, Info, PauseCircle, Play, Square, StopCircle} from 'lucide-react';
import { useStartTask, useStopTask, useCreateTask, useBackends, useTaskEvents } from '../hooks/use-scanner-api';
import * as api from '../lib/api';

import {TaskStatusBadge} from '../components/TaskStatusBadge';

interface TaskDetailProps {
  task: Task;
}

export const TaskDetail: React.FC<TaskDetailProps> = ({ task }) => {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const { mutate: startTask, isPending: isStarting } = useStartTask();
  const { mutate: stopTask, isPending: isStopping } = useStopTask();
  const { mutateAsync: createTask, isPending: isCreating } = useCreateTask();
  const { data: backends = [] } = useBackends();

  // Enable real-time updates
  useTaskEvents(task.backendId || null, task.id);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [task.logs]);

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
          let targets = task.targets;
          if (!targets || targets.length === 0) {
              // fetch from server
              const res = await api.listTasks(backend.address, !!backend.useTls);
              const serverTask = res.ok ? res.data.find(t => t.id === task.id) : null;
              if (serverTask) targets = serverTask.targets;
          }
          
          if (!targets || targets.length === 0) {
              toast.error('Cannot restart: no targets found');
              return;
          }

          const newTask = await createTask({
              backendId: task.backendId,
              name: task.name,
              description: task.description,
              targets
          });
          
          startTask({ backendId: task.backendId, taskId: newTask.id });
          
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

  const isToggling = isStarting || isStopping || isCreating;

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
            <span className="flex items-center gap-1"><Clock size={12} /> Created: {task.createdAt ? new Date(task.createdAt).toLocaleTimeString() : '-'}</span>
            {task.finishedAt && (
              <span className="flex items-center gap-1 text-gray-300">
                End: {task.finishedAt ? new Date(task.finishedAt).toLocaleTimeString() : '-'}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2 relative z-10 ml-4">
          {/* Start button: shown when PENDING or PAUSED */}
          {(task.status === TaskStatus.PENDING || task.status === TaskStatus.PAUSED) && (
            <button onClick={handleStart} disabled={isToggling} title={isToggling ? 'Processing...' : ''} className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-semibold rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <Play size={16} fill="currentColor" /> Start
            </button>
          )}

          {/* Stop button: shown when RUNNING */}
          {task.status === TaskStatus.RUNNING && (
            <button onClick={handleStop} disabled={isToggling} title={isToggling ? 'Processing...' : ''} className="flex items-center gap-2 px-4 py-2 bg-red-900/50 text-red-200 border border-red-900 text-sm font-semibold rounded-md hover:bg-red-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <Square size={16} fill="currentColor" /> Stop
            </button>
          )}

          {/* Restart button: only when DONE */}
          {(task.status === TaskStatus.DONE || task.status === TaskStatus.FAILED) && (
            <button onClick={handleRestart} disabled={isToggling} title={isToggling ? 'Processing...' : 'Restart'} className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-semibold rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <Play size={16} fill="currentColor" /> Restart
            </button>
          )}
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="flex-1 overflow-hidden flex flex-col md:flex-row">

        {/* Left: Metadata & Logs */}
        <div className="flex-1 flex flex-col border-r border-border min-w-0">
          {/* Info Panel */}
          <div className="p-3 bg-card border-b border-border flex flex-col gap-2">
            <div className="flex items-start gap-2 text-sm text-gray-300">
              <Info size={14} className="mt-0.5 text-blue-400" />
              <div className="flex-1 break-all">
                <span className="font-semibold text-xs uppercase tracking-wide text-muted-foreground block mb-0.5">Targets</span>
                {(task.targets ?? []).join(', ')}
              </div>
            </div>
            {(task.exitCode !== undefined || task.errorMessage) && (
              <div className="flex items-start gap-2 text-sm mt-1 p-2 rounded bg-black/20 border border-border">
                <AlertOctagon size={14} className="mt-0.5 text-red-400" />
                <div>
                  {task.exitCode !== undefined && <div className="text-gray-400 text-xs">Exit Code: {task.exitCode}</div>}
                  {task.errorMessage && <div className="text-red-300 font-mono">{task.errorMessage}</div>}
                </div>
              </div>
            )}
          </div>

          <div className="p-2 bg-black/40 text-xs font-mono text-gray-500 border-b border-border flex justify-between">
            <span>STDOUT / STDERR</span>
            <span>Live Feed</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-1 bg-black/20">
            {(task.logs ?? []).length === 0 && <span className="text-gray-700 italic">Waiting for process start...</span>}
            {(task.logs ?? []).map((log, i) => (
              <div key={i} className="flex gap-3">
                <span className="text-gray-600 select-none">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                <span className={`
                            ${log.level === 'error' ? 'text-red-400' : ''}
                            ${log.level === 'warn' ? 'text-yellow-400' : ''}
                            ${log.level === 'success' ? 'text-green-400' : ''}
                            ${log.level === 'info' ? 'text-gray-300' : ''}
                        `}>
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Right: Results & Stats */}
        <div className="w-full md:w-80 bg-secondary/10 flex flex-col border-l border-border">
          <div className="flex-1 p-4 overflow-y-auto">
            <h3 className="text-sm font-semibold text-white mb-3">Scan Results</h3>
            {task.result ? (
              <div className="bg-black/40 rounded-md p-3 border border-border">
                <pre className="text-xs text-green-300 overflow-x-auto whitespace-pre-wrap">
                  {task.result}
                </pre>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground border-2 border-dashed border-border rounded-lg p-8 text-center">
                Results will appear here after completion.
              </div>
            )}
          </div>

          <div className="p-4 border-t border-border">
            <button
              disabled={!task.result}
              className="w-full flex items-center justify-center gap-2 p-2 rounded-md border border-border hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed text-sm text-gray-300"
            >
              <Download size={14} /> Export Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

