import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Task, TaskStatus } from '../types';
import { toast } from 'sonner';
import { AlertOctagon, Check, Clock, Download, Play, Square, X } from 'lucide-react';
import { useStartTask, useStopTask, useBackends } from '../hooks/use-scanner-api';
import * as api from '../lib/api';

import { TaskStatusBadge } from '../components/TaskStatusBadge';
import { microInteraction } from '../lib/motion';
import TaskPortsDetail from './TaskPortsDetail';
import TaskResultPlaceholderDetail from './TaskResultPlaceholderDetail';

export type TaskDetailSection = 'assets' | 'alive' | 'ports' | 'vulns';

interface TaskDetailProps {
  task: Task;
  activeSection?: TaskDetailSection;
}

const getProgressColor = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.DONE: return 'bg-green-500/20';
    case TaskStatus.FAILED: return 'bg-red-500/20';
    case TaskStatus.STOPPED: return 'bg-orange-500/20';
    case TaskStatus.RUNNING: return 'bg-blue-500/20';
    default: return 'bg-muted/30';
  }
};

const downloadTextFile = (content: string, fileName: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const toCsv = (rows: Record<string, unknown>[]) => {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const raw = value == null ? '' : String(value);
    if (raw.includes('"') || raw.includes(',') || raw.includes('\n')) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  };
  const header = columns.join(',');
  const data = rows.map((row) => columns.map((column) => escape(row[column])).join(',')).join('\n');
  return `${header}\n${data}`;
};

type ActionFeedback = 'idle' | 'loading' | 'success' | 'error';
type ActionKey = 'start' | 'stop' | 'restart';

export const TaskDetail: React.FC<TaskDetailProps> = ({ task, activeSection = 'assets' }) => {
  const { t } = useTranslation();
  const { mutate: startTask, isPending: isStarting } = useStartTask();
  const { mutate: stopTask, isPending: isStopping } = useStopTask();
  const { data: backends = [] } = useBackends();
  const [feedback, setFeedback] = useState<Record<ActionKey, ActionFeedback>>({
    start: 'idle',
    stop: 'idle',
    restart: 'idle',
  });
  const resetTimers = useRef<Partial<Record<ActionKey, number>>>({});

  useEffect(() => {
    return () => {
      Object.values(resetTimers.current).forEach((timerId) => {
        if (timerId) window.clearTimeout(timerId);
      });
    };
  }, []);

  const setActionFeedback = (action: ActionKey, state: ActionFeedback) => {
    const timerId = resetTimers.current[action];
    if (timerId) window.clearTimeout(timerId);
    setFeedback((prev) => ({ ...prev, [action]: state }));
    if (state === 'success' || state === 'error') {
      resetTimers.current[action] = window.setTimeout(() => {
        setFeedback((prev) => ({ ...prev, [action]: 'idle' }));
      }, 1400);
    }
  };

  const renderActionIcon = (action: ActionKey, fallback: React.ReactNode) => {
    if (feedback[action] === 'loading') {
      return <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />;
    }
    if (feedback[action] === 'success') return <Check size={14} />;
    if (feedback[action] === 'error') return <X size={14} />;
    return fallback;
  };

  const results = task.results || [];
  const openResults = results.filter((r) => r.state?.toLowerCase() === 'open');

  const handleStart = () => {
    if (!task.backendId) return;
    setActionFeedback('start', 'loading');
    startTask(
      { backendId: task.backendId, taskId: task.id },
      {
        onSuccess: () => setActionFeedback('start', 'success'),
        onError: () => setActionFeedback('start', 'error'),
      },
    );
  };

  const handleStop = () => {
    if (!task.backendId) return;
    setActionFeedback('stop', 'loading');
    stopTask(
      { backendId: task.backendId, taskId: task.id },
      {
        onSuccess: () => setActionFeedback('stop', 'success'),
        onError: () => setActionFeedback('stop', 'error'),
      },
    );
  };

  const handleRestart = async () => {
    if (!task.backendId) return;
    const backend = backends.find((b) => b.id === task.backendId);
    if (!backend?.address) return;
    setActionFeedback('restart', 'loading');
    try {
      const res = await api.restartScan(backend.address, task.id, !!backend.useTls);
      if (!res.ok) {
        setActionFeedback('restart', 'error');
        toast.error(res.error || t('task_detail.restart_failed'));
        return;
      }
      setActionFeedback('restart', 'success');
      toast.success(t('task_detail.restart_success'));
    } catch (e) {
      setActionFeedback('restart', 'error');
      console.error(e);
    }
  };

  const handleExport = (format: 'csv' | 'json') => {
    if (!results.length) {
      toast.error(t('task_detail.export_no_results'));
      return;
    }
    try {
      const exportRows = results.map((row) => {
        const raw = row as unknown as Record<string, unknown>;
        return {
          ip: row.ip ?? '',
          port: row.port ?? '',
          protocol: row.protocol ?? '',
          service: row.service ?? '',
          state: row.state ?? '',
          severity: raw.severity ?? '',
          vulnerabilityId: raw.vulnerabilityId ?? '',
          title: raw.title ?? '',
          evidence: raw.evidence ?? '',
          timestamp: row.timestamp ?? '',
        };
      });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePrefix = `task-${task.id}-report-${stamp}`;
      if (format === 'csv') {
        downloadTextFile(toCsv(exportRows), `${filePrefix}.csv`, 'text/csv;charset=utf-8;');
      } else {
        downloadTextFile(JSON.stringify(exportRows, null, 2), `${filePrefix}.json`, 'application/json;charset=utf-8;');
      }
      toast.success(t('task_detail.export_success', { format: format.toUpperCase() }));
    } catch {
      toast.error(t('task_detail.export_failed'));
    }
  };

  const isToggling = isStarting || isStopping;
  const assetsCount = new Set(results.map((r) => r.ip).filter(Boolean)).size;
  const aliveCount = new Set(openResults.map((r) => r.ip).filter(Boolean)).size;
  const portsCount = openResults.length;
  const vulnsCount = (task.vulnerabilities?.length ?? 0) + results.filter((row) => {
    const raw = row as unknown as Record<string, unknown>;
    return Boolean(raw.severity || raw.vulnerabilityId || raw.vuln || raw.vulnerability);
  }).length;

  const tabs: Array<{ section: TaskDetailSection; title: string; count: number; activeClass: string }> = [
    {
      section: 'assets',
      title: t('task_detail.entry_assets_title'),
      count: assetsCount,
      activeClass: 'from-blue-500/70 to-cyan-500/70 border-blue-300/40',
    },
    {
      section: 'alive',
      title: t('task_detail.entry_alive_title'),
      count: aliveCount,
      activeClass: 'from-emerald-500/70 to-green-500/70 border-emerald-300/40',
    },
    {
      section: 'ports',
      title: t('task_detail.entry_ports_title'),
      count: portsCount,
      activeClass: 'from-violet-500/70 to-fuchsia-500/70 border-violet-300/40',
    },
    {
      section: 'vulns',
      title: t('task_detail.entry_vulns_title'),
      count: vulnsCount,
      activeClass: 'from-rose-500/75 to-red-500/75 border-rose-300/40',
    },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="relative overflow-hidden p-3 sm:p-4 md:p-6 border-b border-border bg-card/60 backdrop-blur-sm flex flex-col items-stretch sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div
          className={`absolute left-0 top-0 bottom-0 transition-all duration-700 ease-out pointer-events-none ${getProgressColor(task.status)}`}
          style={{ width: `${task.progress}%` }}
        />
        <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.35),transparent_55%)]" />
        <div className="relative z-10 min-w-0 w-full">
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-lg sm:text-xl font-bold text-foreground truncate">{task.name}</h2>
            <TaskStatusBadge status={task.status} />
          </div>
          <p className="min-h-5 text-sm text-muted-foreground italic truncate">
            {task.description ? `"${task.description}"` : t('common.na')}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground font-mono mt-1">
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {t('task_detail.created', { time: task.createdAt ? new Date(task.createdAt).toLocaleTimeString() : t('common.na') })}
            </span>
            <span className="flex items-center gap-1">
              {t('task_detail.end', { time: task.finishedAt ? new Date(task.finishedAt).toLocaleTimeString() : t('common.na') })}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 relative z-10 w-full sm:w-auto sm:justify-end">
          {(task.status === TaskStatus.PENDING || task.status === TaskStatus.PAUSED) && (
            <motion.button
              onClick={handleStart}
              disabled={isToggling}
              whileTap={{ scale: microInteraction.actionButtonPress.scale }}
              transition={{ duration: microInteraction.actionButtonPress.duration, ease: microInteraction.actionButtonPress.ease }}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                feedback.start === 'success'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : feedback.start === 'error'
                    ? 'bg-destructive/15 text-destructive border-destructive/40'
                    : 'bg-primary text-primary-foreground border-primary/50 hover:opacity-90'
              }`}
            >
              {renderActionIcon('start', <Play size={14} fill="currentColor" />)}
              <span>{t('task_detail.start')}</span>
            </motion.button>
          )}
          {task.status === TaskStatus.RUNNING && (
            <motion.button
              onClick={handleStop}
              disabled={isToggling}
              whileTap={{ scale: microInteraction.actionButtonPress.scale }}
              transition={{ duration: microInteraction.actionButtonPress.duration, ease: microInteraction.actionButtonPress.ease }}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                feedback.stop === 'success'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : feedback.stop === 'error'
                    ? 'bg-destructive/15 text-destructive border-destructive/40'
                    : 'bg-destructive/20 text-destructive border-destructive/30 hover:bg-destructive/30'
              }`}
            >
              {renderActionIcon('stop', <Square size={14} fill="currentColor" />)}
              <span>{t('task_detail.stop')}</span>
            </motion.button>
          )}
          {(task.status === TaskStatus.DONE || task.status === TaskStatus.FAILED || task.status === TaskStatus.STOPPED) && (
            <motion.button
              onClick={handleRestart}
              disabled={isToggling}
              whileTap={{ scale: microInteraction.actionButtonPress.scale }}
              transition={{ duration: microInteraction.actionButtonPress.duration, ease: microInteraction.actionButtonPress.ease }}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                feedback.restart === 'success'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : feedback.restart === 'error'
                    ? 'bg-destructive/15 text-destructive border-destructive/40'
                    : 'bg-primary text-primary-foreground border-primary/50 hover:opacity-90'
              }`}
            >
              {renderActionIcon('restart', <Play size={14} fill="currentColor" />)}
              <span>{t('task_detail.restart')}</span>
            </motion.button>
          )}
          <motion.button
            onClick={() => handleExport('csv')}
            disabled={results.length === 0}
            whileTap={{ scale: microInteraction.actionButtonPress.scale }}
            transition={{ duration: microInteraction.actionButtonPress.duration, ease: microInteraction.actionButtonPress.ease }}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md border transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-background/80 text-foreground border-border hover:bg-accent/70"
          >
            <Download size={14} />
            <span>{t('task_detail.export_csv')}</span>
          </motion.button>
          <motion.button
            onClick={() => handleExport('json')}
            disabled={results.length === 0}
            whileTap={{ scale: microInteraction.actionButtonPress.scale }}
            transition={{ duration: microInteraction.actionButtonPress.duration, ease: microInteraction.actionButtonPress.ease }}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md border transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-background/80 text-foreground border-border hover:bg-accent/70"
          >
            <Download size={14} />
            <span>{t('task_detail.export_json')}</span>
          </motion.button>
        </div>
      </div>

      {(task.exitCode !== undefined || task.errorMessage) && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20 flex items-start gap-2 text-sm">
          <AlertOctagon size={14} className="mt-0.5 text-destructive flex-shrink-0" />
          <div>
            {task.exitCode !== undefined && <span className="text-muted-foreground text-xs mr-2">{t('task_detail.exit_code', { code: task.exitCode })}</span>}
            {task.errorMessage && <span className="text-destructive font-mono text-xs">{task.errorMessage}</span>}
          </div>
        </div>
      )}

      <div className="border-b border-border bg-card/55 backdrop-blur-sm px-3 sm:px-4 md:px-6 py-3">
        <div className="grid grid-cols-2 gap-2">
          {tabs.map((tab) => {
            const isActive = activeSection === tab.section;
            return (
              <Link
                key={tab.section}
                to={`/task/${task.id}/results/${tab.section}`}
                className={`group rounded-lg border px-3 py-2 transition-all h-[84px] ${
                  isActive
                    ? `bg-gradient-to-r text-white shadow-[0_12px_26px_-18px_rgba(59,130,246,0.9)] ${tab.activeClass}`
                    : 'border-border/70 bg-background/60 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-accent/50'
                }`}
              >
                <div className="h-full flex flex-col items-center justify-center gap-1">
                  <span className={`text-lg sm:text-xl font-black tabular-nums leading-none ${isActive ? 'text-white' : 'text-foreground'}`}>
                    {tab.count}
                  </span>
                  <p className={`text-xs font-semibold tracking-wide uppercase truncate ${isActive ? 'text-white/90' : 'text-muted-foreground group-hover:text-foreground/80'}`}>
                    {tab.title}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 p-3 sm:p-4 md:p-6">
        <div className="h-full rounded-xl border border-border bg-card/60 backdrop-blur-sm overflow-hidden">
          {activeSection === 'ports' ? (
            <TaskPortsDetail task={task} embedded />
          ) : (
            <TaskResultPlaceholderDetail task={task} section={activeSection} embedded />
          )}
        </div>
      </div>
    </div>
  );
};

export default TaskDetail;
