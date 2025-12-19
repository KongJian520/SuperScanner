import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { TaskDetail } from '@/views/TaskDetail';
import { useTaskDetail, useBackends, useTaskEvents } from '../hooks/use-scanner-api';
import { useAppStore } from '../lib/store';

export const TaskDetailRoute: React.FC = () => {
  const { id } = useParams();
  const { activeBackendId } = useAppStore();
  const { data: backends } = useBackends();
  
  const effectiveBackendId = activeBackendId ?? backends?.find(b => b.address)?.id ?? null;
  const { data: task, isLoading } = useTaskDetail(effectiveBackendId, id ?? null);
  
  // Enable real-time updates for this task
  useTaskEvents(effectiveBackendId, id ?? null);
  
  if (!id) return <Navigate to="/tasks" replace />;
  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading task details...</div>;
  if (!task) return <div className="p-8 text-center text-muted-foreground">Task not found</div>;

  return <TaskDetail task={task} />;
};

export default TaskDetailRoute;
