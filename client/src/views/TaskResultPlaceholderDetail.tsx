import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Database,
  Folder,
  Globe,
  Layers,
  Network,
  Shield,
  Terminal,
} from 'lucide-react';
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
  const [pages, setPages] = React.useState<Record<'assets' | 'alive' | 'vulns', number>>({
    assets: 1,
    alive: 1,
    vulns: 1,
  });

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

  const titleMap = {
    assets: t('task_detail.entry_assets_title'),
    alive: t('task_detail.entry_alive_title'),
    vulns: t('task_detail.entry_vulns_title'),
  } as const;

  const descMap = {
    assets: '',
    alive: t('task_detail.entry_alive_desc'),
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
        hostProfiles.length > 0 ? (() => {
          const { rows, page, totalPages } = paginate(hostProfiles, pages.assets);
          return (
            <>
              <div className="grid grid-cols-1 min-[520px]:grid-cols-2 xl:grid-cols-3 gap-3">
                {rows.map((host) => {
                  const HostIcon = pickHostIcon(host.roles);
                  return (
                    <button
                      key={host.ip}
                      type="button"
                      className="w-full rounded-lg border border-border/70 bg-card/70 p-3 text-left hover:bg-accent/50 transition-colors"
                      onClick={() => setSelectedHost(host)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center rounded-md border border-primary/30 bg-primary/10 p-1.5 text-primary">
                          <HostIcon size={16} />
                        </span>
                        <p className="font-mono text-sm font-semibold text-foreground truncate">{host.ip}</p>
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
          <div className="text-sm text-muted-foreground">{t('task_detail.no_results')}</div>
        )
      )}

      {section === 'alive' && (
        aliveIps.length > 0 ? (() => {
          const { rows, page, totalPages } = paginate(aliveIps, pages.alive);
          return tableFrame(
            <>
              <p className="mb-2 text-xs text-muted-foreground">{t('task_detail.alive_ip_only_hint')}</p>
              <div className="space-y-1">
                {rows.map((ip) => (
                  <div key={ip} className="rounded-md border border-border/60 bg-background/50 px-3 py-2 font-mono text-sm text-foreground">
                    {ip}
                  </div>
                ))}
              </div>
              {pager('alive', page, totalPages)}
            </>,
          );
        })() : (
          <div className="text-sm text-muted-foreground">{t('task_detail.no_alive_hosts')}</div>
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
