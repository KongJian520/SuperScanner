import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown } from 'lucide-react';
import { motion } from 'framer-motion';
import { ScanResult } from '../types';
import { microInteraction } from '../lib/motion';

type SortKey = keyof Pick<ScanResult, 'ip' | 'port' | 'protocol' | 'service' | 'state'>;
type SortDir = 'asc' | 'desc';

interface TaskResultsTableProps {
  results: ScanResult[];
}

const TaskResultsTable: React.FC<TaskResultsTableProps> = ({ results }) => {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = useState<SortKey>('ip');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [sortTick, setSortTick] = useState(0);

  const sorted = useMemo(() => {
    return results
      .map((row, originalIndex) => ({ row, originalIndex }))
      .sort((a, b) => {
      const av = sortKey === 'port' ? a.row.port : String(a.row[sortKey] ?? '');
      const bv = sortKey === 'port' ? b.row.port : String(b.row[sortKey] ?? '');
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [results, sortKey, sortDir]);

  const enableRowReorderAnimation = sorted.length <= 200;

  const toggleSort = (key: SortKey) => {
    setSortTick(v => v + 1);
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const Th: React.FC<{ col: SortKey; label: string }> = ({ col, label }) => {
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

  const stateColor = (state: string) => {
    const normalized = state.toLowerCase();
    if (normalized === 'open') return 'text-green-500';
    if (normalized === 'closed') return 'text-red-400';
    return 'text-muted-foreground';
  };

  const stateLabel = (state: string) =>
    t(`task_detail.result_state.${state.toLowerCase()}`, { defaultValue: state });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse min-w-[480px]">
        <thead>
          <tr className="border-b border-border">
            <Th col="ip" label={t('task_detail.table_headers.ip')} />
            <Th col="port" label={t('task_detail.table_headers.port')} />
            <Th col="protocol" label={t('task_detail.table_headers.protocol')} />
            <Th col="service" label={t('task_detail.table_headers.service')} />
            <Th col="state" label={t('task_detail.table_headers.state')} />
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ row: r, originalIndex }) => (
            <motion.tr
              key={originalIndex}
              layout={enableRowReorderAnimation}
              transition={microInteraction.tableRowReorder}
              className="border-b border-border/50 hover:bg-accent/50 transition-colors"
            >
              <td className="px-3 py-2 font-mono text-xs text-foreground">{r.ip}</td>
              <td className="px-3 py-2 font-mono text-xs text-foreground">{r.port}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground uppercase">{r.protocol}</td>
              <td className="px-3 py-2 text-xs text-foreground">{r.service || t('common.na')}</td>
              <td className={`px-3 py-2 text-xs font-medium ${stateColor(r.state)}`}>{stateLabel(r.state)}</td>
            </motion.tr>
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

export default TaskResultsTable;
