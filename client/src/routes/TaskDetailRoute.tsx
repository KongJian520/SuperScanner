import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { Task } from '@/types';
import { TaskDetail } from '@/views/TaskDetail';

interface Props {
  tasks: Task[];
  onUpdate: (updated: Partial<Task>) => void;
  backends: import('../types').BackendConfig[];
}

export const TaskDetailRoute: React.FC<Props> = ({ tasks, onUpdate, backends }) => {
  const { id } = useParams();
  if (!id) return <Navigate to="/tasks" replace />;
  const task = tasks.find(t => t.id === id);
  if (!task) return <Navigate to="/tasks" replace />;
  return <TaskDetail task={task} onUpdate={onUpdate} backends={backends} />;
};

export default TaskDetailRoute;
