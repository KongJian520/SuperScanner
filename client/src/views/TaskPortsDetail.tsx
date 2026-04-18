import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Gauge, Layers, Search } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Task } from '../types';
import TaskResultsTable from '../components/TaskResultsTable';
import { microInteraction } from '../lib/motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ScrollArea } from '../components/ui/scroll-area';

interface TaskPortsDetailProps {
  task: Task;
  embedded?: boolean;
}

const CHART_COLORS = ['#22d3ee', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#94a3b8'];

type DonutItem = { name: string; value: number; filterValue?: string };

function compactTop(items: { name: string; count: number }[], otherLabel: string, limit = 6): DonutItem[] {
  if (items.length <= limit) {
    return items.map((i) => ({ name: i.name, value: i.count, filterValue: i.name }));
  }
  const top = items.slice(0, limit).map((i) => ({ name: i.name, value: i.count, filterValue: i.name }));
  const otherValue = items.slice(limit).reduce((sum, it) => sum + it.count, 0);
  return [...top, { name: otherLabel, value: otherValue }];
}

export const TaskPortsDetail: React.FC<TaskPortsDetailProps> = ({ task, embedded = false }) => {
  const { t } = useTranslation();
  const results = task.results || [];
  const openResults = useMemo(() => results.filter((r) => r.state?.toLowerCase() === 'open'), [results]);
  const rows = openResults.length > 0 ? openResults : results;

  const servicesCount = new Set(rows.map((r) => r.service).filter(Boolean)).size;
  const openPortsCount = openResults.length;
  const uniquePortsCount = new Set(rows.map((r) => r.port)).size;

  const [detailMode, setDetailMode] = useState<'visual' | 'table'>('visual');
  const [search, setSearch] = useState('');
  const [selectedService, setSelectedService] = useState<string | null>(null);

  const serviceDistribution = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const key = (row.service || t('task_detail.unknown_service')).trim();
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [rows, t]);

  const portDistribution = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of rows) {
      map.set(row.port, (map.get(row.port) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([port, count]) => ({ name: String(port), count }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const serviceDonutData = useMemo(
    () => compactTop(serviceDistribution, t('task_detail.ports_chart_other')),
    [serviceDistribution, t],
  );
  const portDonutData = useMemo(
    () => compactTop(portDistribution, t('task_detail.ports_chart_other')),
    [portDistribution, t],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const serviceName = (row.service || t('task_detail.unknown_service')).trim();
      if (selectedService && serviceName !== selectedService) return false;
      if (!q) return true;
      return (
        row.ip.toLowerCase().includes(q)
        || String(row.port).includes(q)
        || (row.service || '').toLowerCase().includes(q)
        || (row.protocol || '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, selectedService, t]);

  const serviceTotal = serviceDonutData.reduce((sum, item) => sum + item.value, 0);
  const portTotal = portDonutData.reduce((sum, item) => sum + item.value, 0);

  const statsGrid = (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Card className="py-3 gap-2 border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-card to-card">
        <CardContent className="px-4 flex items-center gap-3 text-xs text-muted-foreground">
          <Gauge size={16} className="text-emerald-400" />
          <span>{t('task_detail.label_open_ports')}</span>
          <strong className="ml-auto text-base text-foreground">{openPortsCount}</strong>
        </CardContent>
      </Card>
      <Card className="py-3 gap-2 border-blue-500/30 bg-gradient-to-br from-blue-500/10 via-card to-card">
        <CardContent className="px-4 flex items-center gap-3 text-xs text-muted-foreground">
          <Layers size={16} className="text-blue-400" />
          <span>{t('task_detail.ports_unique_ports')}</span>
          <strong className="ml-auto text-base text-foreground">{uniquePortsCount}</strong>
        </CardContent>
      </Card>
      <Card className="py-3 gap-2 border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-card to-card">
        <CardContent className="px-4 flex items-center gap-3 text-xs text-muted-foreground">
          <Layers size={16} className="text-violet-400" />
          <span>{t('task_detail.stat_services')}</span>
          <strong className="ml-auto text-base text-foreground">{servicesCount}</strong>
        </CardContent>
      </Card>
    </div>
  );

  const donutBlock = (
    title: string,
    subtitle: string,
    totalLabel: string,
    data: DonutItem[],
    total: number,
    onItemClick?: (item: DonutItem) => void,
    activeFilter?: string | null,
  ) => (
    <Card className="py-4 gap-3 border-border/70 bg-card/70 min-h-0 overflow-hidden">
      <CardHeader className="px-4 pb-0">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="px-4 min-h-0 space-y-3">
        <div className="relative h-56 rounded-md border border-border/60 bg-background/40">
          {data.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={90}
                    paddingAngle={2}
                    onClick={(_, index) => {
                      if (onItemClick) onItemClick(data[index]);
                    }}
                  >
                    {data.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                        className={onItemClick && !entry.filterValue ? 'opacity-70' : ''}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [value, t('task_detail.label_open_ports')]}
                    contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-2xl font-semibold text-foreground">{total}</p>
                  <p className="text-[11px] text-muted-foreground">{totalLabel}</p>
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              {t('task_detail.no_results')}
            </div>
          )}
        </div>

        <ScrollArea className="h-28 rounded-md border border-border/60 bg-background/30">
          <div className="p-2 space-y-1.5">
            {data.map((item, index) => {
              const percent = total > 0 ? Math.round((item.value / total) * 100) : 0;
              const isActive = !!activeFilter && activeFilter === item.filterValue;
              const clickable = !!onItemClick && !!item.filterValue;
              return (
                <button
                  key={item.name}
                  className={`w-full text-left rounded-md border px-2.5 py-1.5 text-xs transition-colors ${isActive ? 'border-primary/60 bg-primary/10' : 'border-border/50 hover:bg-accent/60'} ${clickable ? '' : 'cursor-default'}`}
                  onClick={() => {
                    if (onItemClick) onItemClick(item);
                  }}
                  disabled={!clickable}
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                    <span className="truncate text-foreground">{item.name}</span>
                    <span className="ml-auto text-muted-foreground">{item.value} · {percent}%</span>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );

  const distributionPanel = (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-h-0">
      {donutBlock(
        t('task_detail.ports_service_donut_title'),
        t('task_detail.ports_service_donut_desc'),
        t('task_detail.ports_service_total'),
        serviceDonutData,
        serviceTotal,
        (item) => {
          const nextFilter = item.filterValue;
          if (!nextFilter) return;
          setSelectedService((prev) => (prev === nextFilter ? null : nextFilter));
        },
        selectedService,
      )}
      {donutBlock(
        t('task_detail.ports_port_donut_title'),
        t('task_detail.ports_port_donut_desc'),
        t('task_detail.ports_port_total'),
        portDonutData,
        portTotal,
      )}
    </div>
  );

  const tablePanel = (
    <Card className="py-4 gap-4 border-border/70 bg-card/70 min-h-0 overflow-hidden">
      <CardHeader className="px-4 pb-0">
        <CardTitle className="text-sm">{t('task_detail.scan_results')}</CardTitle>
        <CardDescription>
          {t('task_detail.ports_filtered_rows', { count: filteredRows.length, total: rows.length })}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 space-y-3 min-h-0">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              placeholder={t('task_detail.ports_search_placeholder')}
            />
          </div>
          {(search || selectedService) && (
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setSelectedService(null);
              }}
            >
              {t('common.clear')}
            </Button>
          )}
        </div>
        {selectedService && (
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
            <span>{t('task_detail.ports_filter_service')}</span>
            <strong>{selectedService}</strong>
          </div>
        )}
        <ScrollArea className="h-[280px] sm:h-[340px] xl:h-[420px] rounded-md border border-border/60 bg-background/40">
          <div className="p-2">
            <TaskResultsTable results={filteredRows} />
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );

  if (embedded) {
    return (
      <div className="h-full min-h-0 flex flex-col gap-3 p-3 sm:p-4 overflow-y-auto">
        {statsGrid}
        <div className="xl:hidden flex flex-col gap-2">
          <div className="flex gap-2">
            <Button size="sm" variant={detailMode === 'visual' ? 'default' : 'outline'} onClick={() => setDetailMode('visual')}>
              {t('task_detail.ports_visual_title')}
            </Button>
            <Button size="sm" variant={detailMode === 'table' ? 'default' : 'outline'} onClick={() => setDetailMode('table')}>
              {t('task_detail.scan_results')}
            </Button>
          </div>
          {detailMode === 'visual' ? distributionPanel : tablePanel}
        </div>
        <div className="hidden xl:grid xl:grid-cols-1 gap-3 min-h-0">
          {distributionPanel}
          {tablePanel}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="relative overflow-hidden p-4 md:p-6 border-b border-border bg-card/60 backdrop-blur-sm">
        <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.35),transparent_55%)]" />
        <div className="relative z-10 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('task_detail.task_name_label', { name: task.name })}</p>
              <h2 className="text-xl md:text-2xl font-bold text-foreground truncate">{t('task_detail.ports_results_title')}</h2>
            </div>
            <motion.div
              whileHover={{ ...microInteraction.cardHoverLift, y: -1, scale: 1 }}
              transition={{ duration: 0.15 }}
            >
              <Link
                to={`/task/${task.id}`}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-3 py-1.5 text-sm rounded-md border border-border bg-background/70 hover:bg-accent/70 transition-colors text-foreground whitespace-nowrap"
              >
                <ArrowLeft size={14} />
                {t('common.back')}
              </Link>
            </motion.div>
          </div>

          {statsGrid}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3">
        <div className="xl:hidden flex flex-col gap-2">
          <div className="flex gap-2">
            <Button size="sm" variant={detailMode === 'visual' ? 'default' : 'outline'} onClick={() => setDetailMode('visual')}>
              {t('task_detail.ports_visual_title')}
            </Button>
            <Button size="sm" variant={detailMode === 'table' ? 'default' : 'outline'} onClick={() => setDetailMode('table')}>
              {t('task_detail.scan_results')}
            </Button>
          </div>
          {detailMode === 'visual' ? distributionPanel : tablePanel}
        </div>

        <div className="hidden xl:flex xl:flex-col gap-3">
          {distributionPanel}
          {tablePanel}
        </div>
      </div>
    </div>
  );
};

export default TaskPortsDetail;
