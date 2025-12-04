import React, {useEffect, useRef} from 'react';
import {LogEntry, Task, TaskStatus} from '../types';
import * as api from '../lib/api';
import {toast} from 'sonner';
import {AlertOctagon, CheckCircle2, Clock, Download, Info, PauseCircle, Play, Square, StopCircle} from 'lucide-react';

interface TaskDetailProps {
  task: Task;
  onUpdate: (updated: Partial<Task>) => void;
  backends?: import('../types').BackendConfig[];
}

export const TaskDetail: React.FC<TaskDetailProps> = ({ task, onUpdate, backends = [] }) => {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [isToggling, setIsToggling] = React.useState(false);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [task.logs]);

  const handleStart = async () => {
    if (isToggling) return;
    setIsToggling(true);
    try {
      // resolve backend address from task.backendId
      const backendId = task.backendId ?? null;
      const foundBackend = backends.find(b => b.id === backendId) ?? null;
      if (!foundBackend || !foundBackend.address) {
        const err = '找不到任务对应的后端地址，无法启动任务';
        toast.error(err);
        console.error(err);
        return;
      }
      const address = foundBackend.address;
      const useTls = !!foundBackend.useTls;
      const res = await api.startScan(address, task.id, useTls);
      if (!res.ok) {
        toast.error('启动任务失败：' + res.error);
        console.error('startScan error', res.error);
        return;
      }

      onUpdate({
        status: TaskStatus.RUNNING,
        startedAt: Date.now(),
        updatedAt: Date.now()
      });

      // Simulating log stream for demo purposes
      simulateProgress();
      toast.success('任务已启动');
    } catch (e) {
      console.error(e);
      toast.error('启动任务出错');
    } finally {
      setIsToggling(false);
    }
  };

  const handleStop = async () => {
    if (isToggling) return;
    setIsToggling(true);
    try {
      const backendId = task.backendId ?? null;
      const foundBackend = backends.find(b => b.id === backendId) ?? null;
      if (!foundBackend || !foundBackend.address) {
        const err = '找不到任务对应的后端地址，无法停止任务';
        toast.error(err);
        console.error(err);
        return;
      }
      const address = foundBackend.address;
      const useTls = !!foundBackend.useTls;
      const res = await api.stopScan(address, task.id, useTls);
      if (!res.ok) {
        toast.error('停止任务失败：' + res.error);
        console.error('stopScan error', res.error);
        return;
      }
      onUpdate({
        status: TaskStatus.STOPPED,
        updatedAt: Date.now(),
        finishedAt: Date.now(),
        exitCode: 130, // SIGINT like code
        logs: [...(task.logs ?? []), createLog('Scan stopped by user', 'warn')]
      });
      toast.success('任务已停止');
    } catch (e) {
      console.error(e);
      toast.error('停止任务出错');
    } finally {
      setIsToggling(false);
    }
  };

  const simulateProgress = () => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 2; // Slower progress to see animation
      const msgs = [
        "Resolving targets...",
        "Initiating handshake...",
        "Checking ports...",
        "Analyzing heuristics...",
        "Fingerprinting OS...",
        "Sending packets..."
      ];

      if (Math.random() > 0.7) {
        const randomMsg = msgs[Math.floor(Math.random() * msgs.length)];
        onUpdate({
          progress,
          updatedAt: Date.now(),
          logs: [...(task.logs ?? []), createLog(randomMsg, 'info')]
        });
      } else {
        onUpdate({ progress, updatedAt: Date.now() });
      }

      if (progress >= 100) {
        clearInterval(interval);
        onUpdate({
          status: TaskStatus.DONE,
          finishedAt: Date.now(),
          updatedAt: Date.now(),
          exitCode: 0,
          logs: [...(task.logs ?? []), createLog('Scan completed successfully.', 'success')],
          result: JSON.stringify({ open_ports: [80, 443, 8080], os: "Linux", vulnerability_score: "Low" }, null, 2)
        });
      }
    }, 200);
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
            <Badge status={task.status} />
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
          {task.status !== TaskStatus.RUNNING ? (
            <button onClick={handleStart} disabled={isToggling} className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-semibold rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <Play size={16} fill="currentColor" /> {task.status === TaskStatus.PENDING ? 'Start' : 'Restart'}
            </button>
          ) : (
            <button onClick={handleStop} disabled={isToggling} className="flex items-center gap-2 px-4 py-2 bg-red-900/50 text-red-200 border border-red-900 text-sm font-semibold rounded-md hover:bg-red-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <Square size={16} fill="currentColor" /> Stop
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
                <span className="text-gray-600 select-none">[{log.timestamp}]</span>
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

const createLog = (msg: string, level: LogEntry['level']): LogEntry => ({
  timestamp: new Date().toLocaleTimeString().split(' ')[0],
  level,
  message: msg
});

const Badge = ({ status }: { status: TaskStatus }) => {
  const styles = {
    [TaskStatus.UNSPECIFIED]: 'bg-gray-800 text-gray-500 border-gray-700',
    [TaskStatus.PENDING]: 'bg-gray-800 text-gray-300 border-gray-700',
    [TaskStatus.RUNNING]: 'bg-blue-900/30 text-blue-300 border-blue-800 animate-pulse',
    [TaskStatus.DONE]: 'bg-green-900/30 text-green-300 border-green-800',
    [TaskStatus.FAILED]: 'bg-red-900/30 text-red-300 border-red-800',
    [TaskStatus.STOPPED]: 'bg-orange-900/30 text-orange-300 border-orange-800',
    [TaskStatus.PAUSED]: 'bg-yellow-900/30 text-yellow-300 border-yellow-800',
  };

  const icons = {
    [TaskStatus.UNSPECIFIED]: <Clock size={12} />,
    [TaskStatus.PENDING]: <Clock size={12} />,
    [TaskStatus.RUNNING]: <ActivityIcon />,
    [TaskStatus.DONE]: <CheckCircle2 size={12} />,
    [TaskStatus.FAILED]: <AlertOctagon size={12} />,
    [TaskStatus.STOPPED]: <StopCircle size={12} />,
    [TaskStatus.PAUSED]: <PauseCircle size={12} />,
  };

  return (
    <span className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] uppercase font-bold border ${styles[status] || styles[TaskStatus.PENDING]}`}>
      {icons[status] || icons[TaskStatus.PENDING]}
      {TaskStatus[status]}
    </span>
  );
};

const ActivityIcon = () => (
  <span className="relative flex h-2 w-2">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
  </span>
);
