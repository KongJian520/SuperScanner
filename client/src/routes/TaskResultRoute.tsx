import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { useTaskDetail, useBackends, useTaskEvents } from '../hooks/use-scanner-api';
import { useAppStore } from '../lib/store';
import { TaskDetail, TaskDetailSection } from '../views/TaskDetail';
import { routeLite, stateTransition } from '../lib/motion';

const isTaskDetailSection = (section: string): section is TaskDetailSection => (
  section === 'assets' || section === 'alive' || section === 'ports' || section === 'vulns'
);

export const TaskResultRoute: React.FC = () => {
  const { t } = useTranslation();
  const { id, section } = useParams();
  const { activeBackendId, defaultBackendId } = useAppStore();
  const { data: backends } = useBackends();

  const effectiveBackendId = activeBackendId ?? defaultBackendId ?? backends?.find(b => b.address)?.id ?? null;
  const { data: task, isLoading, error } = useTaskDetail(effectiveBackendId, id ?? null);

  useTaskEvents(effectiveBackendId, id ?? null);

  if (!id || !section) return <Navigate to="/tasks" replace />;
  if (!isTaskDetailSection(section)) {
    return <Navigate to={`/task/${id}`} replace />;
  }

  return (
    <div className="h-full">
      <AnimatePresence mode="wait" initial={false}>
        {isLoading ? (
          <motion.div
            key="loading"
            className="p-6"
            variants={stateTransition.surface}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <div className="space-y-4">
              <div className="h-24 rounded-xl bg-card/70 border border-border animate-pulse" />
              <div className="h-16 rounded-lg bg-card/60 border border-border animate-pulse" />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-[72px] rounded-lg bg-card/60 border border-border animate-pulse" />
                ))}
              </div>
              <div className="h-72 rounded-xl bg-card/60 border border-border animate-pulse" />
            </div>
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            className="p-8 text-center text-destructive border border-dashed border-destructive/40 bg-destructive/5 rounded-lg"
            variants={stateTransition.surface}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {error.message}
          </motion.div>
        ) : !task ? (
          <motion.div
            key="not-found"
            className="p-8 text-center text-muted-foreground"
            variants={stateTransition.surface}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {t('task_detail.task_not_found')}
          </motion.div>
        ) : (
          <motion.div
            key="content"
            className="h-full"
            variants={routeLite.taskSwitchContainer}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <TaskDetail task={task} activeSection={section} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TaskResultRoute;
