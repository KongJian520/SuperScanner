import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Search,
  Settings2,
  ShieldAlert,
} from 'lucide-react';
import { Task } from '../types';
import { microInteraction } from '../lib/motion';
import { downloadTextFile, toCsv } from '../lib/export-utils';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { ScrollArea } from '../components/ui/scroll-area';

interface TaskFindingsDetailProps {
  task: Task;
  embedded?: boolean;
}

type SortKey = 'severity' | 'title' | 'target' | 'type' | 'source' | 'occurrences' | 'lastSeen';
type SortDir = 'asc' | 'desc';

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
};

const severityStyles: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  critical: { bg: 'bg-red-500/15', text: 'text-red-700 dark:text-red-300', border: 'border-red-500/45', dot: 'bg-red-500' },
  high: { bg: 'bg-orange-500/15', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-500/45', dot: 'bg-orange-500' },
  medium: { bg: 'bg-yellow-500/15', text: 'text-yellow-700 dark:text-yellow-300', border: 'border-yellow-500/45', dot: 'bg-yellow-500' },
  low: { bg: 'bg-blue-500/15', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-500/45', dot: 'bg-blue-500' },
  info: { bg: 'bg-gray-500/15', text: 'text-gray-700 dark:text-gray-300', border: 'border-gray-500/45', dot: 'bg-gray-500' },
};

const SeverityBadge: React.FC<{ severity: string }> = ({ severity }) => {
  const { t } = useTranslation();
  const sev = severity.toLowerCase();
  const style = severityStyles[sev] ?? severityStyles.info;
  const label = t(`task_detail.findings_severity_${sev}`, { defaultValue: severity });
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${style.bg} ${style.text} ${style.border}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {label}
    </span>
  );
};

const formatDate = (iso: string) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
};

const MetadataPanel: React.FC<{ metadataJson: string }> = ({ metadataJson }) => {
  const { t } = useTranslation();
  if (!metadataJson) return null;
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(metadataJson);
  } catch {
    return (
      <div className="space-y-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('task_detail.findings_field_metadata')}</span>
        <pre className="text-foreground text-xs whitespace-pre-wrap break-all">{metadataJson}</pre>
      </div>
    );
  }

  return (
    <>
      {parsed?.template_id != null && (
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Template ID</span>
          <p className="text-foreground text-xs font-mono">{String(parsed.template_id)}</p>
        </div>
      )}
      {parsed?.matched_at != null && (
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Matched At</span>
          <p className="text-foreground text-xs font-mono break-all">{String(parsed.matched_at)}</p>
        </div>
      )}
      {parsed?.extractors != null && (
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Extractors</span>
          <pre className="text-foreground text-xs whitespace-pre-wrap break-all">{JSON.stringify(parsed.extractors, null, 2)}</pre>
        </div>
      )}
      <div className="space-y-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('task_detail.findings_field_metadata')}</span>
        <pre className="text-foreground text-xs whitespace-pre-wrap break-all">{JSON.stringify(parsed, null, 2)}</pre>
      </div>
    </>
  );
};

export const TaskFindingsDetail: React.FC<TaskFindingsDetailProps> = ({ task, embedded = false }) => {
  const { t } = useTranslation();
  const findings = task.findings || [];

  const [sortKey, setSortKey] = useState<SortKey>('severity');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [sortTick, setSortTick] = useState(0);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);

  const toggleSort = (key: SortKey) => {
    setSortTick((v) => v + 1);
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'severity' ? 'desc' : 'asc');
    }
  };

  const findingTypes = useMemo(() => {
    const types = new Set<string>();
    for (const f of findings) {
      if (f.findingType) types.add(f.findingType);
    }
    return Array.from(types).sort();
  }, [findings]);

  const stats = useMemo(() => {
    const critical = findings.filter((f) => f.severity.toLowerCase() === 'critical').length;
    const high = findings.filter((f) => f.severity.toLowerCase() === 'high').length;
    const medium = findings.filter((f) => f.severity.toLowerCase() === 'medium').length;
    return { total: findings.length, critical, high, medium };
  }, [findings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return findings.filter((f) => {
      if (severityFilter !== 'all' && f.severity.toLowerCase() !== severityFilter) return false;
      if (selectedType && f.findingType !== selectedType) return false;
      if (!q) return true;
      return (
        f.ip.toLowerCase().includes(q)
        || f.title.toLowerCase().includes(q)
        || f.findingType.toLowerCase().includes(q)
      );
    });
  }, [findings, severityFilter, selectedType, search]);

  const sorted = useMemo(() => {
    return filtered
      .map((row, idx) => ({ row, idx }))
      .sort((a, b) => {
        let cmp = 0;
        switch (sortKey) {
          case 'severity':
            cmp = (SEVERITY_WEIGHT[a.row.severity.toLowerCase()] ?? -1) - (SEVERITY_WEIGHT[b.row.severity.toLowerCase()] ?? -1);
            break;
          case 'title':
            cmp = a.row.title.localeCompare(b.row.title);
            break;
          case 'target': {
            const ta = a.row.port ? `${a.row.ip}:${a.row.port}` : a.row.ip;
            const tb = b.row.port ? `${b.row.ip}:${b.row.port}` : b.row.ip;
            cmp = ta.localeCompare(tb);
            break;
          }
          case 'type':
            cmp = a.row.findingType.localeCompare(b.row.findingType);
            break;
          case 'source':
            cmp = a.row.sourceTool.localeCompare(b.row.sourceTool);
            break;
          case 'occurrences':
            cmp = a.row.occurrences - b.row.occurrences;
            break;
          case 'lastSeen':
            cmp = a.row.lastSeenAt.localeCompare(b.row.lastSeenAt);
            break;
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [filtered, sortKey, sortDir]);

  const toggleExpand = (id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExport = (format: 'csv' | 'json') => {
    const rows = filtered.map((f) => ({
      severity: f.severity,
      title: f.title,
      target: f.port ? `${f.ip}:${f.port}` : f.ip,
      finding_type: f.findingType,
      source_tool: f.sourceTool,
      detail: f.detail,
      occurrences: f.occurrences,
      last_seen_at: f.lastSeenAt,
    }));
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `task-${task.id}-findings-${ts}`;
    if (format === 'json') {
      downloadTextFile(JSON.stringify(rows, null, 2), `${fileName}.json`, 'application/json');
    } else {
      downloadTextFile(toCsv(rows), `${fileName}.csv`, 'text/csv');
    }
    setExportOpen(false);
  };

  const SortHeader: React.FC<{ col: SortKey; label: string }> = ({ col, label }) => {
    const isActive = sortKey === col;
    const rotate = isActive ? (sortDir === 'asc' ? 0 : 180) : 0;
    return (
      <th
        className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
        onClick={() => toggleSort(col)}
      >
        <span className="flex items-center gap-1">
          {label}
          <motion.span
            key={`${col}-${isActive}-${sortDir}-${sortTick}`}
            initial={false}
            animate={{
              rotate,
              scale: isActive ? [1, 1.16, 1] : 1,
              opacity: isActive ? 1 : 0.4,
            }}
            transition={{
              rotate: { ...microInteraction.tableSortIcon },
              scale: { ...microInteraction.tableSortIcon },
              opacity: { duration: 0.14 },
            }}
            className={isActive ? 'text-primary' : ''}
          >
            <ArrowUpDown size={10} />
          </motion.span>
        </span>
      </th>
    );
  };

  const statsGrid = (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <Card className="py-2 gap-1 border-rose-500/30 bg-gradient-to-br from-rose-500/10 via-card to-card">
        <CardContent className="px-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <ShieldAlert size={16} className="text-rose-400" />
          <span>{t('task_detail.findings_stat_total')}</span>
          <strong className="ml-auto text-sm sm:text-base text-foreground">{stats.total}</strong>
        </CardContent>
      </Card>
      <Card className="py-2 gap-1 border-red-500/30 bg-gradient-to-br from-red-500/10 via-card to-card">
        <CardContent className="px-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <AlertOctagon size={16} className="text-red-400" />
          <span>{t('task_detail.findings_stat_critical')}</span>
          <strong className="ml-auto text-sm sm:text-base text-foreground">{stats.critical}</strong>
        </CardContent>
      </Card>
      <Card className="py-2 gap-1 border-orange-500/30 bg-gradient-to-br from-orange-500/10 via-card to-card">
        <CardContent className="px-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <AlertTriangle size={16} className="text-orange-400" />
          <span>{t('task_detail.findings_stat_high')}</span>
          <strong className="ml-auto text-sm sm:text-base text-foreground">{stats.high}</strong>
        </CardContent>
      </Card>
      <Card className="py-2 gap-1 border-yellow-500/30 bg-gradient-to-br from-yellow-500/10 via-card to-card">
        <CardContent className="px-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <AlertCircle size={16} className="text-yellow-400" />
          <span>{t('task_detail.findings_stat_medium')}</span>
          <strong className="ml-auto text-sm sm:text-base text-foreground">{stats.medium}</strong>
        </CardContent>
      </Card>
    </div>
  );

  const SEVERITY_OPTIONS = ['all', 'critical', 'high', 'medium', 'low', 'info'] as const;

  const filterBar = (
    <div className="flex flex-col sm:flex-row gap-2">
      <div className="flex flex-wrap gap-1">
        {SEVERITY_OPTIONS.map((sev) => (
          <button
            key={sev}
            onClick={() => setSeverityFilter(sev)}
            className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
              severityFilter === sev
                ? 'border-primary/45 bg-primary/15 text-foreground'
                : 'border-border bg-background/60 text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(`task_detail.findings_severity_${sev}`, { defaultValue: sev === 'all' ? 'All' : sev })}
          </button>
        ))}
      </div>
      <div className="relative flex-1">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          placeholder={t('task_detail.findings_search_placeholder')}
        />
      </div>
      {findingTypes.length > 1 && (
        <select
          value={selectedType ?? ''}
          onChange={(e) => setSelectedType(e.target.value || null)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          <option value="">{t('task_detail.findings_all_types')}</option>
          {findingTypes.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      )}
    </div>
  );

  const findingsTable = (
    <ScrollArea className="h-[280px] sm:h-[340px] xl:h-[420px] rounded-md border border-border/60 bg-background/40">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b border-border">
              <SortHeader col="severity" label={t('task_detail.findings_col_severity')} />
              <SortHeader col="title" label={t('task_detail.findings_col_title')} />
              <SortHeader col="target" label={t('task_detail.findings_col_target')} />
              <SortHeader col="type" label={t('task_detail.findings_col_type')} />
              <SortHeader col="source" label={t('task_detail.findings_col_source')} />
              <SortHeader col="occurrences" label={t('task_detail.findings_col_occurrences')} />
              <SortHeader col="lastSeen" label={t('task_detail.findings_col_last_seen')} />
              <th className="px-2 py-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ row: f }) => {
              const isExpanded = expandedRows.has(f.id);
              return (
                <React.Fragment key={f.id}>
                  <motion.tr
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15 }}
                    className="border-b border-border/50 hover:bg-accent/50 transition-colors cursor-pointer"
                    onClick={() => toggleExpand(f.id)}
                  >
                    <td className="px-3 py-2">
                      <SeverityBadge severity={f.severity} />
                    </td>
                    <td className="px-3 py-2 text-xs text-foreground max-w-[200px] truncate" title={f.title}>
                      <span className="font-medium">{f.title}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono whitespace-nowrap">
                      {f.port ? `${f.ip}:${f.port}` : f.ip}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border border-border whitespace-nowrap">
                        {f.findingType}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{f.sourceTool || t('common.na')}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground text-right">{f.occurrences}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDate(f.lastSeenAt) || t('common.na')}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      <motion.span animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
                        <ChevronRight size={14} />
                      </motion.span>
                    </td>
                  </motion.tr>
                  {isExpanded && (
                    <motion.tr
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="bg-muted/30"
                      key={`expanded-${f.id}`}
                    >
                      <td colSpan={8} className="px-4 py-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          {f.detail && (
                            <div className="space-y-1">
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('task_detail.findings_field_detail')}</span>
                              <p className="text-foreground whitespace-pre-wrap break-words">{f.detail}</p>
                            </div>
                          )}
                          <MetadataPanel metadataJson={f.metadataJson} />
                        </div>
                      </td>
                    </motion.tr>
                  )}
                </React.Fragment>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-muted-foreground text-sm">
                  {findings.length === 0
                    ? t('task_detail.findings_no_data')
                    : t('task_detail.findings_no_filter_match')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ScrollArea>
  );

  const exportButton = (
    <div className="relative">
      <motion.button
        whileHover={{ ...microInteraction.cardHoverLift, y: -1, scale: 1 }}
        onClick={() => setExportOpen((v) => !v)}
        disabled={filtered.length === 0}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-background/70 hover:bg-accent/70 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed text-xs"
      >
        <Settings2 size={14} />
        {t('task_detail.findings_export_title')}
        <ChevronDown size={12} />
      </motion.button>
      {exportOpen && (
        <div className="absolute right-0 top-full mt-1 z-30 rounded-md border border-border bg-popover shadow-lg py-1 min-w-[120px]">
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors text-foreground"
            onClick={() => handleExport('csv')}
          >
            CSV
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors text-foreground"
            onClick={() => handleExport('json')}
          >
            JSON
          </button>
        </div>
      )}
      {exportOpen && (
        <div className="fixed inset-0 z-20" onClick={() => setExportOpen(false)} />
      )}
    </div>
  );

  if (embedded) {
    return (
      <div className="h-full min-h-0 flex flex-col gap-3 p-3 sm:p-4 overflow-y-auto">
        {statsGrid}
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">{filterBar}</div>
          {exportButton}
        </div>
        {findingsTable}
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="relative overflow-hidden p-4 md:p-6 border-b border-border bg-card/60 backdrop-blur-sm">
        <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(circle_at_20%_20%,rgba(239,68,68,0.35),transparent_55%)]" />
        <div className="relative z-10 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('task_detail.task_name_label', { name: task.name })}</p>
              <h2 className="text-xl md:text-2xl font-bold text-foreground truncate">{t('task_detail.tab_vulns')}</h2>
            </div>
            <div className="flex items-center gap-2">
              {exportButton}
              <motion.div whileHover={{ ...microInteraction.cardHoverLift, y: -1, scale: 1 }} transition={{ duration: 0.15 }}>
                <Link
                  to={`/task/${task.id}`}
                  className="inline-flex items-center justify-center gap-2 px-3 py-1.5 text-sm rounded-md border border-border bg-background/70 hover:bg-accent/70 transition-colors text-foreground whitespace-nowrap"
                >
                  <ArrowLeft size={14} />
                  {t('common.back')}
                </Link>
              </motion.div>
            </div>
          </div>

          {statsGrid}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">{filterBar}</div>
        </div>
        {findingsTable}
      </div>
    </div>
  );
};

export default TaskFindingsDetail;
