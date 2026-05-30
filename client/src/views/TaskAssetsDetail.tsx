import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft, Database, Folder, Globe, Layers, Network, Search, Shield, Terminal } from 'lucide-react';
import type { Task } from '../types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { buildHostProfiles, type HostProfile } from './host-utils';

interface TaskAssetsDetailProps {
  task: Task;
  embedded?: boolean;
}

const PAGE_SIZE = 10;

const hostIconByRole: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  web: Globe, database: Database, cache: Layers,
  infrastructure: Network, 'remote access': Terminal, 'file service': Folder,
};
const pickHostIcon = (roles: string[]) => hostIconByRole[roles[0]?.trim().toLowerCase()] ?? Shield;

export const TaskAssetsDetail: React.FC<TaskAssetsDetailProps> = ({ task, embedded = false }) => {
  const { t } = useTranslation();
  const hostProfiles = React.useMemo(() => buildHostProfiles(task), [task]);
  const [selectedHost, setSelectedHost] = React.useState<HostProfile | null>(null);
  const [search, setSearch] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);

  const roleOptions = React.useMemo(
    () => Array.from(new Set(hostProfiles.flatMap((h) => h.roles))).sort((a, b) => a.localeCompare(b)),
    [hostProfiles],
  );

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return hostProfiles.filter((host) => {
      if (roleFilter && !host.roles.includes(roleFilter)) return false;
      if (!q) return true;
      return host.ip.toLowerCase().includes(q) || host.roles.some((r) => r.toLowerCase().includes(q))
        || host.services.some((s) => s.toLowerCase().includes(q))
        || host.components.some((c) => c.toLowerCase().includes(q));
    });
  }, [hostProfiles, roleFilter, search]);

  React.useEffect(() => { setPage(1); }, [roleFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const p = Math.min(page, totalPages);
  const rows = filtered.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);

  const pager = (
    <div className="mt-3 flex flex-wrap items-center justify-between sm:justify-end gap-2 text-xs text-muted-foreground">
      <button className="px-2 py-1 rounded border border-border bg-background/70 disabled:opacity-50" disabled={p <= 1} onClick={() => setPage(p - 1)}>
        {t('task_detail.page_prev')}
      </button>
      <span>{t('task_detail.page_info', { page: p, totalPages })}</span>
      <button className="px-2 py-1 rounded border border-border bg-background/70 disabled:opacity-50" disabled={p >= totalPages} onClick={() => setPage(p + 1)}>
        {t('task_detail.page_next')}
      </button>
    </div>
  );

  const hostDialog = (
    <Dialog open={!!selectedHost} onOpenChange={(open) => !open && setSelectedHost(null)}>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader><DialogTitle className="font-mono">{selectedHost?.ip}</DialogTitle></DialogHeader>
        {selectedHost && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {selectedHost.roles.map((role) => (
                <span key={role} className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-200">{role}</span>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(selectedHost.components.length > 0 ? selectedHost.components : selectedHost.services).slice(0, 12).map((c) => (
                <span key={c} className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">{c}</span>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                [t('task_detail.host_profile_open_ports'), selectedHost.openPorts.slice(0, 16).join(', ') || t('common.na')],
                [t('task_detail.host_profile_protocols'), selectedHost.protocols.join(', ') || t('common.na')],
                [t('task_detail.host_profile_services'), selectedHost.services.slice(0, 12).join(', ') || t('common.na')],
                [t('task_detail.host_profile_tools'), selectedHost.tools.join(', ') || t('common.na')],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-border/60 bg-background/40 p-2">
                  <p className="text-muted-foreground">{label}</p>
                  <p className="mt-1 font-mono text-foreground break-all">{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

  const content = (
    <>
      {filtered.length > 0 ? (
        <>
          <div className="mb-3 rounded-lg border border-border/70 bg-card/60 p-3 space-y-2.5">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={t('task_detail.assets_search_placeholder', { defaultValue: 'Search by IP / role / service' })}
                className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground" />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => setRoleFilter(null)}
                className={`px-2 py-1 rounded-md border text-xs ${roleFilter === null ? 'border-primary/45 bg-primary/15 text-foreground' : 'border-border bg-background/60 text-muted-foreground hover:text-foreground'}`}>
                {t('tasks_overview.filter_all')}
              </button>
              {roleOptions.map((role) => (
                <button key={role} onClick={() => setRoleFilter(role)}
                  className={`px-2 py-1 rounded-md border text-xs ${roleFilter === role ? 'border-primary/45 bg-primary/15 text-foreground' : 'border-border bg-background/60 text-muted-foreground hover:text-foreground'}`}>
                  {role}
                </button>
              ))}
              <span className="ml-auto text-xs text-muted-foreground">
                {t('task_detail.assets_filtered_count', { defaultValue: '{{count}} / {{total}} hosts', count: filtered.length, total: hostProfiles.length })}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 min-[520px]:grid-cols-2 xl:grid-cols-3 gap-3">
            {rows.map((host) => {
              const Icon = pickHostIcon(host.roles);
              return (
                <button key={host.ip} type="button" onClick={() => setSelectedHost(host)}
                  className="w-full rounded-lg border border-border/70 bg-card/70 p-3 text-left hover:bg-accent/50 hover:border-primary/30 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex items-center justify-center rounded-md border border-primary/30 bg-primary/10 p-1.5 text-primary shrink-0"><Icon size={16} /></span>
                      <p className="font-mono text-sm font-semibold text-foreground truncate">{host.ip}</p>
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{host.openPorts.length} / {host.services.length}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground truncate">{host.roles.join(', ')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('task_detail.host_profile_open_ports')}: {host.openPorts.length} · {t('task_detail.label_services')}: {host.services.length}
                  </p>
                </button>
              );
            })}
          </div>
          {pager}
        </>
      ) : (
        <div className="text-sm text-muted-foreground">
          {hostProfiles.length > 0 ? t('tasks_overview.no_filter_match') : t('task_detail.no_results')}
        </div>
      )}
    </>
  );

  if (embedded) return <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">{content}{hostDialog}</div>;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="p-3 sm:p-4 md:p-6 border-b border-border bg-card/60 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('task_detail.task_name_label', { name: task.name })}</p>
            <h2 className="text-xl md:text-2xl font-bold text-foreground truncate">{t('task_detail.entry_assets_title')}</h2>
          </div>
          <Link to={`/task/${task.id}`}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-border bg-background/70 hover:bg-accent/70 transition-colors text-foreground whitespace-nowrap">
            <ArrowLeft size={14} />{t('common.back')}
          </Link>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">{content}</div>
      {hostDialog}
    </div>
  );
};

export default TaskAssetsDetail;
