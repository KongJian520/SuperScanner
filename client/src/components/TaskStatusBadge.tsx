import { TaskStatus } from '../types';
import { AlertOctagon, CheckCircle2, Clock, PauseCircle, StopCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const TaskStatusBadge = ({ status }: { status: TaskStatus }) => {
  const { t } = useTranslation();
  const styles = {
    [TaskStatus.UNSPECIFIED]: 'bg-muted text-muted-foreground border-border',
    [TaskStatus.PENDING]: 'bg-muted text-muted-foreground border-border',
    [TaskStatus.RUNNING]: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/45 animate-pulse',
    [TaskStatus.DONE]: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/45',
    [TaskStatus.FAILED]: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/45',
    [TaskStatus.STOPPED]: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/45',
    [TaskStatus.PAUSED]: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/45',
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
      {t(`task_status.${TaskStatus[status]?.toLowerCase() ?? 'pending'}`)}
    </span>
  );
};

const ActivityIcon = () => (
  <span className="relative flex h-2 w-2">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
  </span>
);
