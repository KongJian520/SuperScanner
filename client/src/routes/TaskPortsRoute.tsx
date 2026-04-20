import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTaskDetail, useBackends, useTaskEvents } from '../hooks/use-scanner-api';
import { useAppStore } from '../lib/store';
import TaskPortsDetail from '../views/TaskPortsDetail';
import { pickEffectiveBackendId } from '../lib/backend-selection';

export const TaskPortsRoute: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const { activeBackendId, defaultBackendId } = useAppStore();
  const { data: backends } = useBackends();

  const effectiveBackendId = pickEffectiveBackendId(backends, activeBackendId, defaultBackendId);
  const { data: task, isLoading } = useTaskDetail(effectiveBackendId, id ?? null);

  useTaskEvents(effectiveBackendId, id ?? null);

  if (!id) return <Navigate to="/tasks" replace />;
  if (isLoading) return <div className="p-8 text-center text-muted-foreground">{t('task_detail.loading_task_details')}</div>;
  if (!task) return <div className="p-8 text-center text-muted-foreground">{t('task_detail.task_not_found')}</div>;

  return <TaskPortsDetail task={task} />;
};

export default TaskPortsRoute;
