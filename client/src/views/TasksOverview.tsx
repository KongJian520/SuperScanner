import React from 'react';
import { useNavigate } from 'react-router-dom';
import { List as ListIcon, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppStore } from '../lib/store';
import { useTasks, useDeleteTask, useBackends } from '../hooks/use-scanner-api';
import { Task, TaskStatus } from '../types';
import { TaskStatusBadge } from '../components/TaskStatusBadge';
import { FixedSizeList as ListWindow, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useTranslation } from 'react-i18next';
import { microInteraction, routeLite, stateTransition } from '../lib/motion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { pickEffectiveBackendId } from '../lib/backend-selection';

const rowVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.995, filter: 'blur(5px)' },
  show: (index: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: {
      duration: 0.32,
      delay: Math.min(index * 0.03, 0.2),
    },
  }),
};

type TaskFilter = 'all' | 'running' | 'done' | 'failed' | 'stopped';

export const TasksOverview: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeBackendId, defaultBackendId, setActiveTaskId, setActiveBackendId } = useAppStore();
  const { data: backends } = useBackends();
  const [taskFilter, setTaskFilter] = React.useState<TaskFilter>('all');
  const [search, setSearch] = React.useState('');
  const [isNarrowScreen, setIsNarrowScreen] = React.useState(() => window.matchMedia('(max-width: 767px)').matches);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const onChange = (event: MediaQueryListEvent) => setIsNarrowScreen(event.matches);
    setIsNarrowScreen(mediaQuery.matches);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);

  const effectiveBackendId = pickEffectiveBackendId(backends, activeBackendId, defaultBackendId);
  const { data: tasks = [], isLoading, error } = useTasks(effectiveBackendId);
  const { mutate: deleteTask } = useDeleteTask();

  const normalizedSearch = search.trim().toLowerCase();
  const filteredTasks = React.useMemo(
    () => tasks.filter((task) => {
      const byStatus =
        taskFilter === 'all'
          || (taskFilter === 'running' && task.status === TaskStatus.RUNNING)
          || (taskFilter === 'done' && task.status === TaskStatus.DONE)
          || (taskFilter === 'failed' && task.status === TaskStatus.FAILED)
          || (taskFilter === 'stopped' && task.status === TaskStatus.STOPPED);
      if (!byStatus) return false;
      if (!normalizedSearch) return true;
      return (
        task.name.toLowerCase().includes(normalizedSearch)
        || (task.description ?? '').toLowerCase().includes(normalizedSearch)
        || (task.targets ?? []).some((target) => target.toLowerCase().includes(normalizedSearch))
      );
    }),
    [tasks, taskFilter, normalizedSearch],
  );

  const handleSelectTask = (id: string) => {
    setActiveTaskId(id);
    setActiveBackendId(effectiveBackendId);
    navigate(`/task/${id}`);
  };

  const handleDeleteTask = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (effectiveBackendId) {
      deleteTask({ backendId: effectiveBackendId, taskId: id });
    }
  };

  const getProgressStyles = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.DONE:
        return 'bg-green-500/20';
      case TaskStatus.FAILED:
        return 'bg-red-500/20';
      case TaskStatus.STOPPED:
        return 'bg-orange-500/20';
      case TaskStatus.RUNNING:
        return 'bg-blue-500/20';
      default:
        return 'bg-muted/30';
    }
  };

  const getStatusDotClass = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.DONE:
        return 'bg-green-500';
      case TaskStatus.FAILED:
        return 'bg-red-500';
      case TaskStatus.STOPPED:
        return 'bg-orange-500';
      case TaskStatus.RUNNING:
        return 'bg-blue-500';
      default:
        return 'bg-muted-foreground/60';
    }
  };

  const renderTaskRow = (task: Task, index: number, style?: React.CSSProperties) => (
    <div style={style} className="px-1 py-1">
      <motion.div
        custom={index}
        variants={rowVariants}
        initial="hidden"
        animate="show"
        whileHover={isNarrowScreen ? undefined : {
          ...microInteraction.cardHoverLift,
          transition: { type: 'spring', stiffness: 300, damping: 24 },
        }}
        whileTap={isNarrowScreen ? undefined : { scale: 0.996 }}
        className="relative overflow-hidden flex items-center justify-between p-2.5 sm:p-3 bg-card rounded-md cursor-pointer hover:bg-accent transition-colors group h-full touch-pan-y"
        onClick={() => handleSelectTask(task.id)}
      >
        <div
          className={`absolute left-0 top-0 bottom-0 transition-all duration-500 ease-out pointer-events-none ${getProgressStyles(task.status)}`}
          style={{ width: `${task.progress}%` }}
        />

        <div className="relative z-10 flex items-center gap-4 min-w-0">
          <div className="min-w-0">
            <div className="font-semibold flex items-center gap-2 min-w-0">
              <motion.span
                layout
                className={`w-2 h-2 rounded-full ${getStatusDotClass(task.status)}`}
                animate={task.status === TaskStatus.RUNNING ? { scale: [1, 1.2, 1], opacity: [0.7, 1, 0.7] } : { scale: 1, opacity: 0.9 }}
                transition={task.status === TaskStatus.RUNNING ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
              />
              <span className="truncate max-w-[10rem] sm:max-w-[16rem]">{task.name}</span>
              <TaskStatusBadge status={task.status} />
            </div>
            <div className="text-xs text-muted-foreground">
              {t('sidebar.targets', { count: task.targets?.length ?? 0 })}
            </div>
          </div>
        </div>
        <div className="relative z-10 shrink-0">
          <button onClick={(e) => handleDeleteTask(task.id, e)} className="text-sm text-destructive/80 hover:text-destructive hover:bg-destructive/10 px-1.5 py-0.5 rounded-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all">
            {t('common.delete')}
          </button>
        </div>
      </motion.div>
    </div>
  );

  const Row = ({ index, style }: ListChildComponentProps) => {
    const task = filteredTasks[index];
    return renderTaskRow(task, index, style);
  };

  const filters: Array<{ key: TaskFilter; label: string }> = [
    { key: 'all', label: t('tasks_overview.filter_all') },
    { key: 'running', label: t('task_status.running') },
    { key: 'done', label: t('task_status.done') },
    { key: 'failed', label: t('task_status.failed') },
    { key: 'stopped', label: t('task_status.stopped') },
  ];

  return (
    <motion.div
      className={isNarrowScreen
        ? 'p-3 h-full overflow-y-auto pb-20 space-y-3'
        : 'p-3 sm:p-6 h-full flex flex-col gap-3 sm:gap-5'}
      variants={routeLite.mainNavSwitch}
      initial="initial"
      animate="animate"
    >
      <div className="flex items-center justify-between flex-shrink-0">
        <motion.div
          className="flex items-center gap-3"
          initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          <ListIcon />
          <div>
            <h3 className="text-base sm:text-lg font-semibold">{t('tasks_overview.list_title')}</h3>
            <p className="text-xs text-muted-foreground">{t('tasks_overview.list_subtitle')}</p>
          </div>
        </motion.div>
      </div>

      <div className="flex-shrink-0 grid gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('tasks_overview.search_placeholder')}
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <button
              key={filter.key}
              onClick={() => setTaskFilter(filter.key)}
              className={`px-2.5 py-1 rounded-md border text-xs transition-colors ${taskFilter === filter.key ? 'bg-primary/15 border-primary/40 text-foreground' : 'bg-background/60 border-border text-muted-foreground hover:text-foreground'}`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className={isNarrowScreen
        ? 'rounded-2xl border border-border/80 bg-card/70 backdrop-blur-sm p-2'
        : 'flex-1 min-h-0 rounded-2xl border border-border/80 bg-card/70 backdrop-blur-sm p-2 sm:p-3 overflow-hidden'}>
        <AnimatePresence mode="wait" initial={false}>
          {isLoading ? (
            <motion.div
              key="loading"
              className="space-y-2 p-1"
              variants={stateTransition.surface}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {[...Array(5)].map((_, i) => (
                <motion.div
                  key={i}
                  className="h-[72px] rounded-md bg-card"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: [0.35, 0.6, 0.35], y: 0 }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.08 }}
                />
              ))}
            </motion.div>
          ) : error ? (
            <motion.div
              key="error"
              className="text-sm text-destructive border border-dashed border-destructive/40 bg-destructive/5 rounded-md p-4"
              variants={stateTransition.surface}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {error.message}
            </motion.div>
          ) : tasks.length === 0 ? (
            <motion.div
              key="empty"
              className="text-sm text-muted-foreground p-3"
              variants={stateTransition.surface}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {t('tasks.empty')}
            </motion.div>
          ) : filteredTasks.length === 0 ? (
            <motion.div
              key="no-match"
              className="text-sm text-muted-foreground p-3"
              variants={stateTransition.surface}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {t('tasks_overview.no_filter_match')}
            </motion.div>
          ) : (
            <motion.div
              key="tasks-list"
              className={isNarrowScreen ? '' : 'h-full'}
              variants={stateTransition.surface}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {isNarrowScreen ? (
                <ScrollArea className="h-[52vh] min-h-[320px]" viewportClassName="touch-pan-y overscroll-y-contain">
                  <div className="pb-2">
                    {filteredTasks.map((task, index) => (
                      <React.Fragment key={task.id}>
                        {renderTaskRow(task, index)}
                      </React.Fragment>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <AutoSizer>
                  {({ height, width }) => (
                    <ListWindow
                      height={height}
                      itemCount={filteredTasks.length}
                      itemSize={80}
                      width={width}
                    >
                      {Row}
                    </ListWindow>
                  )}
                </AutoSizer>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default TasksOverview;
