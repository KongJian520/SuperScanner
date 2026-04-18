import React from 'react';
import { Activity, Gauge, Radar, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useBackends, useTasks } from '../hooks/use-scanner-api';
import { useAppStore } from '../lib/store';
import { TaskStatus } from '../types';
import { routeLite } from '../lib/motion';

export const DashboardOverview: React.FC = () => {
  const { t } = useTranslation();
  const { activeBackendId, defaultBackendId } = useAppStore();
  const { data: backends } = useBackends();
  const effectiveBackendId = activeBackendId ?? defaultBackendId ?? backends?.find((b) => b.address)?.id ?? null;
  const { data: tasks = [] } = useTasks(effectiveBackendId);
  const hasBackend = Boolean(effectiveBackendId);

  const stats = React.useMemo(() => {
    const running = tasks.filter((task) => task.status === TaskStatus.RUNNING).length;
    const done = tasks.filter((task) => task.status === TaskStatus.DONE).length;
    const failed = tasks.filter((task) => task.status === TaskStatus.FAILED || task.status === TaskStatus.STOPPED).length;
    const totalTargets = tasks.reduce((acc, task) => acc + (task.targets?.length ?? 0), 0);
    const avgProgress = tasks.length > 0
      ? Math.round(tasks.reduce((acc, task) => acc + task.progress, 0) / tasks.length)
      : 0;
    const latestTask = [...tasks].sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))[0];
    return {
      total: tasks.length,
      running,
      done,
      failed,
      totalTargets,
      avgProgress,
      latestTaskName: latestTask?.name ?? t('common.no_data'),
    };
  }, [tasks, t]);

  const cards = [
    {
      key: 'total',
      title: t('tasks_overview.total_tasks'),
      value: stats.total,
      subtitle: t('tasks_overview.total_targets', { count: stats.totalTargets }),
      icon: <Radar size={18} />,
      className: 'from-blue-500/25 to-cyan-500/10 border-blue-500/40',
    },
    {
      key: 'running',
      title: t('tasks_overview.running_tasks'),
      value: stats.running,
      subtitle: `${stats.avgProgress}% ${t('tasks_overview.avg_progress')}`,
      icon: <Activity size={18} />,
      className: 'from-violet-500/25 to-blue-500/10 border-violet-500/40',
    },
    {
      key: 'done',
      title: t('tasks_overview.completed_tasks'),
      value: stats.done,
      subtitle: t('tasks_overview.recent_update', { name: stats.latestTaskName }),
      icon: <TrendingUp size={18} />,
      className: 'from-emerald-500/25 to-green-500/10 border-emerald-500/40',
    },
    {
      key: 'failed',
      title: t('tasks_overview.failed_tasks'),
      value: stats.failed,
      subtitle: hasBackend ? t('tasks_overview.open_task_list') : t('tasks_overview.no_backend_hint'),
      icon: <Gauge size={18} />,
      className: 'from-rose-500/25 to-orange-500/10 border-rose-500/40',
    },
  ];

  return (
    <motion.div
      className="p-3 sm:p-6 h-full overflow-y-auto pb-20 md:pb-6"
      variants={routeLite.mainNavSwitch}
      initial="initial"
      animate="animate"
    >
      <motion.div
        className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/15 via-card to-card p-4 sm:p-5"
        initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          className="pointer-events-none absolute -top-20 -right-20 w-56 h-56 rounded-full bg-primary/15 blur-3xl"
          animate={{ scale: [1, 1.15, 1], opacity: [0.2, 0.35, 0.2] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="relative z-10 space-y-1">
          <div className="text-xs tracking-wider uppercase text-primary">{t('tasks_overview.dashboard_title')}</div>
          <h2 className="text-xl sm:text-2xl font-bold">{t('activity_bar.dashboard')}</h2>
          <p className="text-sm text-muted-foreground">{t('tasks_overview.dashboard_subtitle')}</p>
        </div>
      </motion.div>

      <div className="mt-3 sm:mt-5 grid grid-cols-2 xl:grid-cols-4 gap-3">
        {cards.map((card, index) => (
          <motion.div
            key={card.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: Math.min(index * 0.05, 0.2) }}
            className={`relative overflow-hidden rounded-xl border p-3 sm:p-4 bg-gradient-to-br ${card.className}`}
          >
            <div className="flex items-start justify-between gap-2 sm:gap-3 min-w-0">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{card.title}</p>
                <p className="mt-1.5 text-xl sm:text-2xl font-black tabular-nums">{card.value}</p>
                <p className="mt-1 text-[11px] sm:text-xs text-muted-foreground truncate">{card.subtitle}</p>
              </div>
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-background/40 border border-white/10 flex items-center justify-center text-primary shrink-0">
                {card.icon}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
};

export default DashboardOverview;
