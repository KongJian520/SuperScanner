import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpDown, Copy, Download, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { Task } from '../types';
import { downloadTextFile } from '../lib/export-utils';

interface TaskAliveDetailProps {
  task: Task;
  embedded?: boolean;
}

const PAGE_SIZE = 20;

const compareIp = (a: string, b: string) => {
  const ap = a.split('.').map((v) => Number.parseInt(v, 10));
  const bp = b.split('.').map((v) => Number.parseInt(v, 10));
  if (ap.length === 4 && bp.length === 4 && ap.every(Number.isFinite) && bp.every(Number.isFinite)) {
    for (let i = 0; i < 4; i += 1) { if (ap[i] !== bp[i]) return ap[i] - bp[i]; }
    return 0;
  }
  return a.localeCompare(b);
};

export const TaskAliveDetail: React.FC<TaskAliveDetailProps> = ({ task, embedded = false }) => {
  const { t } = useTranslation();
  const results = task.results || [];
  const openResults = results.filter((r) => r.state?.toLowerCase() === 'open');
  const aliveIps = React.useMemo(() => Array.from(new Set(openResults.map((r) => r.ip).filter(Boolean))).sort(), [openResults]);
  const [search, setSearch] = React.useState('');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');
  const [page, setPage] = React.useState(1);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q ? aliveIps.filter((ip) => ip.toLowerCase().includes(q)) : aliveIps;
    const sorted = [...rows].sort(compareIp);
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [aliveIps, search, sortDir]);

  React.useEffect(() => { setPage(1); }, [search, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const p = Math.min(page, totalPages);
  const rows = filtered.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);

  const handleCopy = () => {
    if (filtered.length === 0) return;
    navigator.clipboard?.writeText(filtered.join('\n'))
      .then(() => toast.success(t('task_detail.alive_copy_success', { defaultValue: 'Copied {{count}} alive IPs', count: filtered.length })))
      .catch(() => toast.error(t('task_detail.alive_copy_failed', { defaultValue: 'Failed to copy' })));
  };

  const handleExport = () => {
    if (filtered.length === 0) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(filtered.join('\n'), `task-${task.id}-alive-ips-${stamp}.txt`, 'text/plain;charset=utf-8;');
    toast.success(t('task_detail.alive_export_success', { defaultValue: 'Exported {{count}} alive IPs', count: filtered.length }));
  };

  const content = (
    <>
      {filtered.length > 0 ? (
        <>
          <div className="mb-2 flex flex-col md:flex-row md:items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={t('task_detail.alive_search_placeholder', { defaultValue: 'Search alive IPs' })}
                className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground" />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setSortDir((p) => (p === 'asc' ? 'desc' : 'asc'))}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent/60">
                <ArrowUpDown size={13} />
                <span>{sortDir === 'asc' ? t('task_detail.sort_asc', { defaultValue: 'Asc' }) : t('task_detail.sort_desc', { defaultValue: 'Desc' })}</span>
              </button>
              <button onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent/60">
                <Copy size={13} /><span>{t('common.copy', { defaultValue: 'Copy' })}</span>
              </button>
              <button onClick={handleExport}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent/60">
                <Download size={13} /><span>{t('common.export', { defaultValue: 'Export' })}</span>
              </button>
            </div>
          </div>
          <div className="rounded-md border border-border/60 bg-background/35 overflow-hidden">
            {rows.map((ip, idx) => (
              <div key={ip} className={`px-3 py-2 ${idx < rows.length - 1 ? 'border-b border-border/50' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm text-foreground">{ip}</span>
                  <Link to={`/task/${task.id}/results/ports?q=${encodeURIComponent(ip)}`} className="text-xs text-primary hover:text-primary/80">
                    {t('task_detail.view_ports', { defaultValue: 'View ports' })}
                  </Link>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between sm:justify-end gap-2 text-xs text-muted-foreground">
            <button className="px-2 py-1 rounded border border-border bg-background/70 disabled:opacity-50" disabled={p <= 1} onClick={() => setPage(p - 1)}>
              {t('task_detail.page_prev')}
            </button>
            <span>{t('task_detail.page_info', { page: p, totalPages })}</span>
            <button className="px-2 py-1 rounded border border-border bg-background/70 disabled:opacity-50" disabled={p >= totalPages} onClick={() => setPage(p + 1)}>
              {t('task_detail.page_next')}
            </button>
          </div>
        </>
      ) : (
        <div className="text-sm text-muted-foreground">
          {aliveIps.length > 0 ? t('tasks_overview.no_filter_match') : t('task_detail.no_alive_hosts')}
        </div>
      )}
    </>
  );

  if (embedded) return <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">{content}</div>;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="p-3 sm:p-4 md:p-6 border-b border-border bg-card/60 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('task_detail.task_name_label', { name: task.name })}</p>
            <h2 className="text-xl md:text-2xl font-bold text-foreground truncate">{t('task_detail.entry_alive_title')}</h2>
          </div>
          <Link to={`/task/${task.id}`}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-border bg-background/70 hover:bg-accent/70 transition-colors text-foreground whitespace-nowrap">
            <ArrowLeft size={14} />{t('common.back')}
          </Link>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">{content}</div>
    </div>
  );
};

export default TaskAliveDetail;
