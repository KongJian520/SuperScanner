import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Task, TaskStatus, ScanResult } from '../types';
import { toast } from 'sonner';
import { AlertOctagon, ArrowUpDown, Clock, Info, Play, Square } from 'lucide-react';
import { useStartTask, useStopTask, useBackends } from '../hooks/use-scanner-api';
import * as api from '../lib/api';

import { TaskStatusBadge } from '../components/TaskStatusBadge';
import DashboardGrid from '../components/DashboardGrid';

interface TaskDetailProps {
  task: Task;
}

type SortKey = keyof Pick<ScanResult, 'ip' | 'port' | 'protocol' | 'service' | 'state'>;
type SortDir = 'asc' | 'desc';

const getProgressColor = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.DONE:    return 'bg-green-500/20';
    case TaskStatus.FAILED:  return 'bg-red-500/20';
    case TaskStatus.STOPPED: return 'bg-orange-500/20';
    case TaskStatus.RUNNING: return 'bg-blue-500/20';
    default:                 return 'bg-muted/30';
  }
};

const ResultsTable: React.FC<{ results: ScanResult[] }> = ({ results }) => {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = useState<SortKey>('ip');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const sorted = useMemo(() => {
    return [...results].sort((a, b) => {
      const av = sortKey === 'port' ? a.port : String(a[sortKey] ?? '');
      const bv = sortKey === 'port' ? b.port : String(b[sortKey] ?? '');
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [results, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const Th: React.FC<{ col: SortKey; label: string }> = ({ col, label }) => (
    <th
      className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
      onClick={() => toggleSort(col)}
    >
      <span className="flex items-center gap-1">
        {label}
        <ArrowUpDown size={10} className={sortKey === col ? 'text-primary' : 'opacity-40'} />
      </span>
    </th>
  );

  const stateColor = (state: string) => {
    if (state === 'open') return 'text-green-500';
    if (state === 'closed') return 'text-red-400';
    return 'text-muted-foreground';
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse min-w-[480px]">
        <thead>
          <tr className="border-b border-border">
            <Th col="ip" label="IP" />
            <Th col="port" label="Port" />
            <Th col="protocol" label="Proto" />
            <Th col="service" label="Service" />
            <Th col="state" label="State" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-accent/50 transition-colors">
              <td className="px-3 py-2 font-mono text-xs text-foreground">{r.ip}</td>
              <td className="px-3 py-2 font-mono text-xs text-foreground">{r.port}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground uppercase">{r.protocol}</td>
              <td className="px-3 py-2 text-xs text-foreground">{r.service || '-'}</td>
              <td className={`px-3 py-2 text-xs font-medium ${stateColor(r.state)}`}>{r.state}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
      <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground text-sm">{t('task_detail.no_results')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

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
      if (!res.ok) { toast.error(res.error || '重启任务失败'); return; }
      toast.success(t('task_detail.restart_success'));
    } catch (e) { console.error(e); }
  };

  const isToggling = isStarting || isStopping;
  const results = task.results || [];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="relative overflow-hidden p-4 md:p-6 border-b border-border bg-card/50 flex items-center justify-between gap-4">
        <div
          className={`absolute left-0 top-0 bottom-0 transition-all duration-700 ease-out pointer-events-none ${getProgressColor(task.status)}`}
          style={{ width: `${task.progress}%` }}
        />
        <div className="relative z-10 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-xl font-bold text-foreground truncate">{task.name}</h2>
            <TaskStatusBadge status={task.status} />
          </div>
          {task.description && (
            <p className="text-sm text-muted-foreground italic truncate">"{task.description}"</p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground font-mono mt-1">
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {t('task_detail.created', { time: task.createdAt ? new Date(task.createdAt).toLocaleTimeString() : '-' })}
            </span>
            {task.finishedAt && (
              <span className="flex items-center gap-1">
                {t('task_detail.end', { time: new Date(task.finishedAt).toLocaleTimeString() })}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2 relative z-10 flex-shrink-0">
          {(task.status === TaskStatus.PENDING || task.status === TaskStatus.PAUSED) && (
            <button
              onClick={handleStart} disabled={isToggling}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-semibold rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isStarting ? <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> : <Play size={14} fill="currentColor" />}
              <span className="hidden sm:inline">{t('task_detail.start')}</span>
            </button>
          )}
          {task.status === TaskStatus.RUNNING && (
            <button
              onClick={handleStop} disabled={isToggling}
              className="flex items-center gap-2 px-3 py-1.5 bg-destructive/20 text-destructive border border-destructive/30 text-sm font-semibold rounded-md hover:bg-destructive/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isStopping ? <span className="w-4 h-4 border-2 border-destructive/30 border-t-destructive rounded-full animate-spin" /> : <Square size={14} fill="currentColor" />}
              <span className="hidden sm:inline">{t('task_detail.stop')}</span>
            </button>
          )}
          {(task.status === TaskStatus.DONE || task.status === TaskStatus.FAILED) && (
            <button
              onClick={handleRestart} disabled={isToggling}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-semibold rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={14} fill="currentColor" />
              <span className="hidden sm:inline">{t('task_detail.restart')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Error / Info bar */}
      {(task.exitCode !== undefined || task.errorMessage) && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20 flex items-start gap-2 text-sm">
          <AlertOctagon size={14} className="mt-0.5 text-destructive flex-shrink-0" />
          <div>
            {task.exitCode !== undefined && <span className="text-muted-foreground text-xs mr-2">{t('task_detail.exit_code', { code: task.exitCode })}</span>}
            {task.errorMessage && <span className="text-destructive font-mono text-xs">{task.errorMessage}</span>}
          </div>
        </div>
      )}

      {/* Stats summary row */}
      <div className="flex items-center gap-6 px-4 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground flex-shrink-0">
        <Info size={12} className="text-blue-400 flex-shrink-0" />
        <span>{t('task_detail.stat_assets')} <strong className="text-foreground">{new Set(results.map(r => r.ip)).size}</strong></span>
        <span>{t('task_detail.stat_ports')} <strong className="text-foreground">{results.length}</strong></span>
        <span>{t('task_detail.stat_services')} <strong className="text-foreground">{new Set(results.map(r => r.service).filter(Boolean)).size}</strong></span>
        <span>{t('task_detail.stat_vulns')} <strong className="text-foreground">0</strong></span>
      </div>

      {/* Main content: charts left, table right */}
      <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
        {/* Left: charts */}
        <div className="md:w-[45%] lg:w-[40%] overflow-y-auto p-4 border-b md:border-b-0 md:border-r border-border">
          <DashboardGrid results={results} />
        </div>

        {/* Right: results table */}
        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">{t('task_detail.scan_results')}</h3>
          <ResultsTable results={results} />
        </div>
      </div>
    </div>
  );
};

export default TaskDetail;
