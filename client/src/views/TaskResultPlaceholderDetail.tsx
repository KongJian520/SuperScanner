import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ArrowUpDown,
  ArrowLeft,
  Copy,
  Database,
  Download,
  Folder,
  Globe,
  Layers,
  Network,
  Search,
  Shield,
  Terminal,
} from 'lucide-react';
import { toast } from 'sonner';
import { ScanType, Task, VulnerabilityRecord } from '../types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';

interface TaskResultPlaceholderDetailProps {
  task: Task;
  section: 'assets' | 'alive' | 'vulns';
  embedded?: boolean;
}

const PAGE_SIZE = 10;

interface HostProfile {
  ip: string;
  openPorts: number[];
  services: string[];
  protocols: string[];
  tools: string[];
  roles: string[];
  components: string[];
  lastSeen: string;
}

const roleByService: Record<string, string> = {
  http: 'Web',
  https: 'Web',
  nginx: 'Web',
  apache: 'Web',
  iis: 'Web',
  mysql: 'Database',
  mssql: 'Database',
  postgresql: 'Database',
  redis: 'Cache',
  mongodb: 'Database',
  ssh: 'Remote Access',
  rdp: 'Remote Access',
  smb: 'File Service',
  ftp: 'File Service',
  dns: 'Infrastructure',
  ntp: 'Infrastructure',
  snmp: 'Infrastructure',
};

const componentByService: Record<string, string> = {
  http: 'HTTP Stack',
  https: 'TLS Endpoint',
  nginx: 'Nginx',
  apache: 'Apache',
  iis: 'IIS',
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  mssql: 'SQL Server',
  redis: 'Redis',
  mongodb: 'MongoDB',
  ssh: 'SSH Daemon',
  rdp: 'RDP Service',
  smb: 'SMB Service',
  ftp: 'FTP Service',
  dns: 'DNS Service',
};

const dedupeSort = (items: string[]) => Array.from(new Set(items.filter(Boolean))).sort((a, b) => a.localeCompare(b));

const toServiceKey = (service: string) => service.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const compareIp = (a: string, b: string) => {
  const ap = a.split('.').map((v) => Number.parseInt(v, 10));
  const bp = b.split('.').map((v) => Number.parseInt(v, 10));
  if (ap.length === 4 && bp.length === 4 && ap.every(Number.isFinite) && bp.every(Number.isFinite)) {
    for (let i = 0; i < 4; i += 1) {
      if (ap[i] !== bp[i]) return ap[i] - bp[i];
    }
    return 0;
  }
  return a.localeCompare(b);
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

const hostIconByRole: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  web: Globe,
  database: Database,
  cache: Layers,
  infrastructure: Network,
  'remote access': Terminal,
  'file service': Folder,
};

const pickHostIcon = (roles: string[]) => {
  const key = roles[0]?.trim().toLowerCase();
  return hostIconByRole[key] ?? Shield;
};

const buildHostProfiles = (task: Task): HostProfile[] => {
  const byIp = new Map<string, typeof task.results>();
  for (const row of task.results || []) {
    if (!row.ip) continue;
    const rows = byIp.get(row.ip) ?? [];
    rows.push(row);
    byIp.set(row.ip, rows);
  }

  return Array.from(byIp.entries())
    .map(([ip, rows]) => {
      const openRows = rows.filter((r) => r.state?.toLowerCase() === 'open');
      const rowsForProfile = openRows.length > 0 ? openRows : rows;
      const services = dedupeSort(rowsForProfile.map((r) => (r.service || 'unknown').trim()));
      const serviceKeys = services.map(toServiceKey);
      const roles = dedupeSort(serviceKeys.map((k) => roleByService[k]).filter(Boolean));
      const components = dedupeSort(serviceKeys.map((k) => componentByService[k]).filter(Boolean));
      const timestamps = rowsForProfile.map((r) => r.timestamp).filter(Boolean).sort();
      return {
        ip,
        openPorts: Array.from(new Set(rowsForProfile.map((r) => r.port).filter((p) => Number.isFinite(p)))).sort((a, b) => a - b),
        services,
        protocols: dedupeSort(rowsForProfile.map((r) => r.protocol)),
        tools: dedupeSort(rowsForProfile.map((r) => r.tool)),
        roles: roles.length > 0 ? roles : ['General Host'],
        components,
        lastSeen: timestamps[timestamps.length - 1] || '',
      };
    })
    .sort((a, b) => a.ip.localeCompare(b.ip));
};

export const TaskResultPlaceholderDetail: React.FC<TaskResultPlaceholderDetailProps> = ({ task, section, embedded = false }) => {
  const { t } = useTranslation();
  const results = task.results || [];
  const openResults = results.filter((r) => r.state?.toLowerCase() === 'open');
  const aliveIps = Array.from(new Set(openResults.map((r) => r.ip).filter(Boolean))).sort();
  const hostProfiles = buildHostProfiles(task);
  const hasPocStep = task.workflow?.steps?.some((step) => step.type === ScanType.Poc) ?? false;
  const [selectedHost, setSelectedHost] = React.useState<HostProfile | null>(null);
  const [assetSearch, setAssetSearch] = React.useState('');
  const [assetRoleFilter, setAssetRoleFilter] = React.useState<string | null>(null);
  const [aliveSearch, setAliveSearch] = React.useState('');
  const [aliveSortDir, setAliveSortDir] = React.useState<'asc' | 'desc'>('asc');
  const [pages, setPages] = React.useState<Record<'assets' | 'alive' | 'vulns', number>>({
    assets: 1,
    alive: 1,
    vulns: 1,
  });

  const assetRoleOptions = React.useMemo(
    () =>
      Array.from(
        new Set(hostProfiles.flatMap((host) => host.roles).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [hostProfiles],
  );

  const filteredHostProfiles = React.useMemo(() => {
    const q = assetSearch.trim().toLowerCase();
    return hostProfiles.filter((host) => {
      if (assetRoleFilter && !host.roles.includes(assetRoleFilter)) return false;
      if (!q) return true;
      return (
        host.ip.toLowerCase().includes(q)
        || host.roles.some((role) => role.toLowerCase().includes(q))
        || host.services.some((service) => service.toLowerCase().includes(q))
        || host.components.some((component) => component.toLowerCase().includes(q))
      );
    });
  }, [hostProfiles, assetRoleFilter, assetSearch]);

  const filteredAliveIps = React.useMemo(() => {
    const q = aliveSearch.trim().toLowerCase();
    const rows = q ? aliveIps.filter((ip) => ip.toLowerCase().includes(q)) : aliveIps;
    const sorted = [...rows].sort(compareIp);
    return aliveSortDir === 'desc' ? sorted.reverse() : sorted;
  }, [aliveIps, aliveSearch, aliveSortDir]);

  const parsedVulnsFromResults = results.flatMap((row): VulnerabilityRecord[] => {
    const raw = row as unknown as Record<string, unknown>;
    const nested = (raw.vulnerability ?? raw.vuln) as Record<string, unknown> | undefined;
    const id = String(raw.vulnerabilityId ?? raw.id ?? nested?.id ?? '').trim();
    const severity = String(raw.severity ?? nested?.severity ?? '').trim();
    const title = String(raw.title ?? nested?.title ?? raw.service ?? '').trim();
    const evidence = String(raw.evidence ?? nested?.evidence ?? '').trim();
    const status = String(raw.vulnStatus ?? raw.status ?? nested?.status ?? '').trim();
    if (!id && !severity && !title && !evidence) return [];
    const target = row.ip ? `${row.ip}${row.port ? `:${row.port}` : ''}` : String(raw.target ?? '').trim();
    return [{
      id: id || undefined,
      severity: severity || undefined,
      title: title || undefined,
      evidence: evidence || undefined,
      status: status || undefined,
      target: target || undefined,
    }];
  });

  const vulnRows = [...(task.vulnerabilities ?? []), ...parsedVulnsFromResults];

  const paginate = <T,>(rows: T[], page: number) => {
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const fixedPage = Math.min(page, totalPages);
    const start = (fixedPage - 1) * PAGE_SIZE;
    return {
      rows: rows.slice(start, start + PAGE_SIZE),
      page: fixedPage,
      totalPages,
    };
  };

  const changePage = (targetSection: 'assets' | 'alive' | 'vulns', nextPage: number, totalPages: number) => {
    const clamped = Math.min(Math.max(nextPage, 1), totalPages);
    setPages((prev) => ({ ...prev, [targetSection]: clamped }));
  };

  React.useEffect(() => {
    setPages((prev) => ({ ...prev, assets: 1 }));
  }, [assetRoleFilter, assetSearch]);

  React.useEffect(() => {
    setPages((prev) => ({ ...prev, alive: 1 }));
  }, [aliveSearch, aliveSortDir]);

  const handleCopyAliveIps = React.useCallback(() => {
    if (filteredAliveIps.length === 0) return;
    const payload = filteredAliveIps.join('\n');
    if (!navigator.clipboard?.writeText) {
      toast.error(t('task_detail.alive_copy_unsupported', { defaultValue: 'Clipboard is unavailable in current environment' }));
      return;
    }
    navigator.clipboard
      .writeText(payload)
      .then(() => {
        toast.success(t('task_detail.alive_copy_success', {
          defaultValue: 'Copied {{count}} alive IPs',
          count: filteredAliveIps.length,
        }));
      })
      .catch(() => {
        toast.error(t('task_detail.alive_copy_failed', { defaultValue: 'Failed to copy alive IP list' }));
      });
  }, [filteredAliveIps, t]);

  const handleExportAliveIps = React.useCallback(() => {
    if (filteredAliveIps.length === 0) return;
    const content = filteredAliveIps.join('\n');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(content, `task-${task.id}-alive-ips-${stamp}.txt`, 'text/plain;charset=utf-8;');
    toast.success(t('task_detail.alive_export_success', {
      defaultValue: 'Exported {{count}} alive IPs',
      count: filteredAliveIps.length,
    }));
  }, [filteredAliveIps, task.id, t]);

  const titleMap = {
    assets: t('task_detail.entry_assets_title'),
    alive: t('task_detail.entry_alive_title'),
    vulns: t('task_detail.entry_vulns_title'),
  } as const;

  const descMap = {
    assets: '',
    alive: '',
    vulns: t('task_detail.entry_vulns_desc'),
  } as const;

  const tableFrame = (content: React.ReactNode) => (
    <div className="rounded-lg border border-border bg-card/70 p-3 sm:p-4 overflow-x-auto">
      {content}
    </div>
  );

  const pager = (targetSection: 'assets' | 'alive' | 'vulns', page: number, totalPages: number) => (
    <div className="mt-3 flex flex-wrap items-center justify-between sm:justify-end gap-2 text-xs text-muted-foreground">
      <button
        className="px-2 py-1 rounded border border-border bg-background/70 disabled:opacity-50"
        disabled={page <= 1}
        onClick={() => changePage(targetSection, page - 1, totalPages)}
      >
        {t('task_detail.page_prev')}
      </button>
      <span>{t('task_detail.page_info', { page, totalPages })}</span>
      <button
        className="px-2 py-1 rounded border border-border bg-background/70 disabled:opacity-50"
        disabled={page >= totalPages}
        onClick={() => changePage(targetSection, page + 1, totalPages)}
      >
        {t('task_detail.page_next')}
      </button>
    </div>
  );

  const sectionBody = (
    <>
      {section === 'assets' && (
        filteredHostProfiles.length > 0 ? (() => {
          const { rows, page, totalPages } = paginate(filteredHostProfiles, pages.assets);
          return (
            <>
              <div className="mb-3 rounded-lg border border-border/70 bg-card/60 p-3 space-y-2.5">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={assetSearch}
                    onChange={(e) => setAssetSearch(e.target.value)}
                    placeholder={t('task_detail.assets_search_placeholder', { defaultValue: 'Search by IP / role / service' })}
                    className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAssetRoleFilter(null)}
                    className={`px-2 py-1 rounded-md border text-xs ${assetRoleFilter === null ? 'border-primary/45 bg-primary/15 text-foreground' : 'border-border bg-background/60 text-muted-foreground hover:text-foreground'}`}
                  >
                    {t('tasks_overview.filter_all')}
                  </button>
                  {assetRoleOptions.map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setAssetRoleFilter(role)}
                      className={`px-2 py-1 rounded-md border text-xs ${assetRoleFilter === role ? 'border-primary/45 bg-primary/15 text-foreground' : 'border-border bg-background/60 text-muted-foreground hover:text-foreground'}`}
                    >
                      {role}
                    </button>
                  ))}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {t('task_detail.assets_filtered_count', {
                      defaultValue: '{{count}} / {{total}} hosts',
                      count: filteredHostProfiles.length,
                      total: hostProfiles.length,
                    })}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 min-[520px]:grid-cols-2 xl:grid-cols-3 gap-3">
                {rows.map((host) => {
                  const HostIcon = pickHostIcon(host.roles);
                  return (
                    <button
                      key={host.ip}
                      type="button"
                      className="w-full rounded-lg border border-border/70 bg-card/70 p-3 text-left hover:bg-accent/50 hover:border-primary/30 transition-colors"
                      onClick={() => setSelectedHost(host)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-flex items-center justify-center rounded-md border border-primary/30 bg-primary/10 p-1.5 text-primary shrink-0">
                            <HostIcon size={16} />
                          </span>
                          <p className="font-mono text-sm font-semibold text-foreground truncate">{host.ip}</p>
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {host.openPorts.length} / {host.services.length}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground truncate">{host.roles.join(', ')}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('task_detail.host_profile_open_ports')}: {host.openPorts.length} · {t('task_detail.label_services')}: {host.services.length}
                      </p>
                    </button>
                  );
                })}
              </div>
              {pager('assets', page, totalPages)}
            </>
          );
        })() : (
          <div className="text-sm text-muted-foreground">
            {hostProfiles.length > 0 ? t('tasks_overview.no_filter_match') : t('task_detail.no_results')}
          </div>
        )
      )}

      {section === 'alive' && (
        filteredAliveIps.length > 0 ? (() => {
          const { rows, page, totalPages } = paginate(filteredAliveIps, pages.alive);
          return (
            <>
              <div className="mb-2 flex flex-col md:flex-row md:items-center gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={aliveSearch}
                    onChange={(e) => setAliveSearch(e.target.value)}
                    placeholder={t('task_detail.alive_search_placeholder', { defaultValue: 'Search alive IPs' })}
                    className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAliveSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent/60"
                  >
                    <ArrowUpDown size={13} />
                    <span>{aliveSortDir === 'asc' ? t('task_detail.sort_asc', { defaultValue: 'Asc' }) : t('task_detail.sort_desc', { defaultValue: 'Desc' })}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyAliveIps}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent/60"
                  >
                    <Copy size={13} />
                    <span>{t('common.copy', { defaultValue: 'Copy' })}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportAliveIps}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent/60"
                  >
                    <Download size={13} />
                    <span>{t('common.export', { defaultValue: 'Export' })}</span>
                  </button>
                </div>
              </div>
              <div className="rounded-md border border-border/60 bg-background/35 overflow-hidden">
                {rows.map((ip, idx) => (
                  <div key={ip} className={`px-3 py-2 ${idx < rows.length - 1 ? 'border-b border-border/50' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm text-foreground">{ip}</span>
                      <Link
                        to={`/task/${task.id}/results/ports?q=${encodeURIComponent(ip)}`}
                        className="text-xs text-primary hover:text-primary/80"
                      >
                        {t('task_detail.view_ports', { defaultValue: 'View ports' })}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
              {pager('alive', page, totalPages)}
            </>
          );
        })() : (
          <div className="text-sm text-muted-foreground">
            {aliveIps.length > 0 ? t('tasks_overview.no_filter_match') : t('task_detail.no_alive_hosts')}
          </div>
        )
      )}

      {section === 'vulns' && (
        hasPocStep ? (
          vulnRows.length > 0 ? (() => {
            const { rows, page, totalPages } = paginate(vulnRows, pages.vulns);
            return tableFrame(
              <>
                <table className="w-full text-sm min-w-[620px] sm:min-w-[720px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-3 text-xs uppercase text-muted-foreground">{t('task_detail.vuln_col_severity')}</th>
                      <th className="text-left py-2 pr-3 text-xs uppercase text-muted-foreground">{t('task_detail.vuln_col_title')}</th>
                      <th className="text-left py-2 pr-3 text-xs uppercase text-muted-foreground">{t('task_detail.vuln_col_target')}</th>
                      <th className="text-left py-2 pr-3 text-xs uppercase text-muted-foreground">{t('task_detail.vuln_col_status')}</th>
                      <th className="text-left py-2 text-xs uppercase text-muted-foreground">{t('task_detail.vuln_col_evidence')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={`${row.id ?? 'v'}-${row.target ?? idx}-${idx}`} className="border-b border-border/50">
                        <td className="py-2 pr-3 text-xs">{row.severity || t('common.na')}</td>
                        <td className="py-2 pr-3 text-xs">{row.title || row.id || t('common.na')}</td>
                        <td className="py-2 pr-3 text-xs font-mono">{row.target || t('common.na')}</td>
                        <td className="py-2 pr-3 text-xs">{row.status || t('common.na')}</td>
                        <td className="py-2 text-xs max-w-[32ch] truncate" title={row.evidence || ''}>{row.evidence || t('common.na')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pager('vulns', page, totalPages)}
              </>,
            );
          })() : (
            <div className="text-sm text-muted-foreground">{t('task_detail.no_structured_vuln_data')}</div>
          )
        ) : (
          <div className="text-sm text-muted-foreground">{t('task_detail.vuln_step_not_enabled')}</div>
        )
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="h-full min-h-0 flex flex-col">
        {section !== 'assets' ? (
          <div className="px-3 sm:px-4 py-3 border-b border-border bg-card/45">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{titleMap[section]}</p>
            {descMap[section] ? <p className="mt-1 text-sm text-muted-foreground">{descMap[section]}</p> : null}
          </div>
        ) : null}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">{sectionBody}</div>
        <Dialog open={!!selectedHost} onOpenChange={(open) => !open && setSelectedHost(null)}>
          <DialogContent className="sm:max-w-[760px]">
            <DialogHeader>
              <DialogTitle className="font-mono">{selectedHost?.ip}</DialogTitle>
            </DialogHeader>
            {selectedHost && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{t('task_detail.host_profile_last_seen')}: {selectedHost.lastSeen || t('common.na')}</span>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs uppercase text-muted-foreground">{t('task_detail.host_profile_roles')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedHost.roles.map((role) => (
                      <span key={role} className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-200">
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs uppercase text-muted-foreground">{t('task_detail.host_profile_components')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(selectedHost.components.length > 0 ? selectedHost.components : selectedHost.services).slice(0, 12).map((component) => (
                      <span key={component} className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">
                        {component}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-border/60 bg-background/40 p-2">
                    <p className="text-muted-foreground">{t('task_detail.host_profile_open_ports')}</p>
                    <p className="mt-1 font-mono text-foreground break-all">{selectedHost.openPorts.slice(0, 16).join(', ') || t('common.na')}</p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background/40 p-2">
                    <p className="text-muted-foreground">{t('task_detail.host_profile_protocols')}</p>
                    <p className="mt-1 text-foreground">{selectedHost.protocols.join(', ') || t('common.na')}</p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background/40 p-2">
                    <p className="text-muted-foreground">{t('task_detail.host_profile_services')}</p>
                    <p className="mt-1 text-foreground break-all">{selectedHost.services.slice(0, 12).join(', ') || t('common.na')}</p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background/40 p-2">
                    <p className="text-muted-foreground">{t('task_detail.host_profile_tools')}</p>
                    <p className="mt-1 text-foreground">{selectedHost.tools.join(', ') || t('common.na')}</p>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="p-3 sm:p-4 md:p-6 border-b border-border bg-card/60 backdrop-blur-sm">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('task_detail.task_name_label', { name: task.name })}</p>
            <h2 className="text-xl md:text-2xl font-bold text-foreground truncate">{titleMap[section]}</h2>
            {descMap[section] ? <p className="mt-1 text-sm text-muted-foreground">{descMap[section]}</p> : null}
          </div>
          <Link
            to={`/task/${task.id}`}
            className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-3 py-1.5 text-sm rounded-md border border-border bg-background/70 hover:bg-accent/70 transition-colors text-foreground whitespace-nowrap"
          >
            <ArrowLeft size={14} />
            {t('common.back')}
          </Link>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">{sectionBody}</div>
      <Dialog open={!!selectedHost} onOpenChange={(open) => !open && setSelectedHost(null)}>
        <DialogContent className="sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle className="font-mono">{selectedHost?.ip}</DialogTitle>
          </DialogHeader>
          {selectedHost && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{t('task_detail.host_profile_last_seen')}: {selectedHost.lastSeen || t('common.na')}</span>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs uppercase text-muted-foreground">{t('task_detail.host_profile_roles')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedHost.roles.map((role) => (
                    <span key={role} className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-200">
                      {role}
                    </span>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs uppercase text-muted-foreground">{t('task_detail.host_profile_components')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedHost.components.length > 0 ? selectedHost.components : selectedHost.services).slice(0, 12).map((component) => (
                    <span key={component} className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">
                      {component}
                    </span>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border border-border/60 bg-background/40 p-2">
                  <p className="text-muted-foreground">{t('task_detail.host_profile_open_ports')}</p>
                  <p className="mt-1 font-mono text-foreground break-all">{selectedHost.openPorts.slice(0, 16).join(', ') || t('common.na')}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/40 p-2">
                  <p className="text-muted-foreground">{t('task_detail.host_profile_protocols')}</p>
                  <p className="mt-1 text-foreground">{selectedHost.protocols.join(', ') || t('common.na')}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/40 p-2">
                  <p className="text-muted-foreground">{t('task_detail.host_profile_services')}</p>
                  <p className="mt-1 text-foreground break-all">{selectedHost.services.slice(0, 12).join(', ') || t('common.na')}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/40 p-2">
                  <p className="text-muted-foreground">{t('task_detail.host_profile_tools')}</p>
                  <p className="mt-1 text-foreground">{selectedHost.tools.join(', ') || t('common.na')}</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TaskResultPlaceholderDetail;
