import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { TaskDetail } from '@/views/TaskDetail';
import { useTasks, useBackends, useTaskEvents } from '../hooks/use-scanner-api';
import { useAppStore } from '../lib/store';

export const TaskDetailRoute: React.FC = () => {
  const { id } = useParams();
  const { activeBackendId } = useAppStore();
  const { data: backends } = useBackends();
  
  const effectiveBackendId = activeBackendId ?? backends?.find(b => b.address)?.id ?? null;
  const { data: tasks } = useTasks(effectiveBackendId);
  
  // Enable real-time updates for this task
  useTaskEvents(effectiveBackendId, id ?? null);
  
  const task = tasks?.find(t => t.id === id);

  if (!id) return <Navigate to="/tasks" replace />;
  if (!task) return <div className="p-8 text-center text-muted-foreground">Loading task details...</div>;

  return <TaskDetail task={task} />;
};

export default TaskDetailRoute;
