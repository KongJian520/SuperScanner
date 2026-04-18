import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ScanType, Task, VulnerabilityRecord } from '../types';

interface TaskResultPlaceholderDetailProps {
  task: Task;
  section: 'assets' | 'alive' | 'vulns';
  embedded?: boolean;
}

const PAGE_SIZE = 10;

export const TaskResultPlaceholderDetail: React.FC<TaskResultPlaceholderDetailProps> = ({ task, section, embedded = false }) => {
  const { t } = useTranslation();
  const results = task.results || [];
  const uniqueIps = Array.from(new Set(results.map(r => r.ip).filter(Boolean))).sort();
  const openResults = results.filter(r => r.state?.toLowerCase() === 'open');
  const aliveIps = Array.from(new Set(openResults.map(r => r.ip).filter(Boolean))).sort();
  const hasPocStep = task.workflow?.steps?.some((step) => step.type === ScanType.Poc) ?? false;
  const [pages, setPages] = React.useState<Record<'assets' | 'alive' | 'vulns', number>>({
    assets: 1,
    alive: 1,
    vulns: 1,
  });

  const assetRows = uniqueIps.map((ip) => {
    const ipResults = results.filter((r) => r.ip === ip);
    const openPorts = ipResults.filter((r) => r.state?.toLowerCase() === 'open').length;
    const services = new Set(ipResults.map((r) => r.service).filter(Boolean)).size;
    return { ip, openPorts, services };
  });

  const aliveRows = aliveIps.map((ip) => {
    const openPorts = openResults.filter((r) => r.ip === ip).length;
    const services = new Set(openResults.filter((r) => r.ip === ip).map((r) => r.service).filter(Boolean)).size;
    return { ip, openPorts, services };
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
    assets: t('task_detail.entry_assets_desc'),
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
        assetRows.length > 0 ? (() => {
          const { rows, page, totalPages } = paginate(assetRows, pages.assets);
          return tableFrame(
            <>
                <table className="w-full text-sm min-w-[360px] sm:min-w-[420px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-3 text-xs uppercase text-muted-foreground">{t('task_detail.table_headers.ip')}</th>
                    <th className="text-left py-2 pr-3 text-xs uppercase text-muted-foreground">{t('task_detail.label_open_ports')}</th>
                    <th className="text-left py-2 text-xs uppercase text-muted-foreground">{t('task_detail.label_services')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.ip} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-mono text-xs">{row.ip}</td>
                      <td className="py-2 pr-3 text-xs">{row.openPorts}</td>
                      <td className="py-2 text-xs">{row.services}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pager('assets', page, totalPages)}
            </>,
          );
        })() : (
          <div className="text-sm text-muted-foreground">{t('task_detail.no_results')}</div>
        )
      )}

      {section === 'alive' && (
        aliveRows.length > 0 ? (() => {
          const { rows, page, totalPages } = paginate(aliveRows, pages.alive);
          return tableFrame(
            <>
                <table className="w-full text-sm min-w-[360px] sm:min-w-[420px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-3 text-xs uppercase text-muted-foreground">{t('task_detail.table_headers.ip')}</th>
                    <th className="text-left py-2 pr-3 text-xs uppercase text-muted-foreground">{t('task_detail.label_open_ports')}</th>
                    <th className="text-left py-2 text-xs uppercase text-muted-foreground">{t('task_detail.label_services')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.ip} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-mono text-xs">{row.ip}</td>
                      <td className="py-2 pr-3 text-xs">{row.openPorts}</td>
                      <td className="py-2 text-xs">{row.services}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
        <div className="px-3 sm:px-4 py-3 border-b border-border bg-card/45">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{titleMap[section]}</p>
          <p className="mt-1 text-sm text-muted-foreground">{descMap[section]}</p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">{sectionBody}</div>
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
            <p className="mt-1 text-sm text-muted-foreground">{descMap[section]}</p>
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
    </div>
  );
};

export default TaskResultPlaceholderDetail;
