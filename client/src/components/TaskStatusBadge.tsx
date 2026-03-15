import { TaskStatus } from '../types';
import { AlertOctagon, CheckCircle2, Clock, PauseCircle, StopCircle } from 'lucide-react';

export const TaskStatusBadge = ({ status }: { status: TaskStatus }) => {
  const styles = {
    [TaskStatus.UNSPECIFIED]: 'bg-gray-800 text-gray-500 border-gray-700',
    [TaskStatus.PENDING]: 'bg-gray-800 text-gray-300 border-gray-700',
    [TaskStatus.RUNNING]: 'bg-blue-900/30 text-blue-300 border-blue-800 animate-pulse',
    [TaskStatus.DONE]: 'bg-green-900/30 text-green-300 border-green-800',
    [TaskStatus.FAILED]: 'bg-red-900/30 text-red-300 border-red-800',
    [TaskStatus.STOPPED]: 'bg-orange-900/30 text-orange-300 border-orange-800',
    [TaskStatus.PAUSED]: 'bg-yellow-900/30 text-yellow-300 border-yellow-800',
  };

  const icons = {
    [TaskStatus.UNSPECIFIED]: <Clock size={12} />,
    [TaskStatus.PENDING]: <Clock size={12} />,
    [TaskStatus.RUNNING]: <ActivityIcon />,
    [TaskStatus.DONE]: <CheckCircle2 size={12} />,
    [TaskStatus.FAILED]: <AlertOctagon size={12} />,
    [TaskStatus.STOPPED]: <StopCircle size={12} />,
    [TaskStatus.PAUSED]: <PauseCircle size={12} />,
  };

  return (
    <span className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] uppercase font-bold border ${styles[status] || styles[TaskStatus.PENDING]}`}>
      {icons[status] || icons[TaskStatus.PENDING]}
      {TaskStatus[status]}
    </span>
  );
};

const ActivityIcon = () => (
  <span className="relative flex h-2 w-2">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
  </span>
);
