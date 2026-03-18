import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity, Box, CheckCircle2, Clock, List, PauseCircle,
  Plus, Server, ShieldAlert, StopCircle, Trash2
} from 'lucide-react';
import { TaskStatus } from '../types';
import { useNavigate, useMatch } from 'react-router-dom';
import { useAppStore } from '../lib/store';
import { useBackends, useTasks, useDeleteBackend, useDeleteTask, useTaskEvents } from '../hooks/use-scanner-api';

const TaskEventListener: React.FC<{ backendId: string | null; taskId: string }> = ({ backendId, taskId }) => {
  useTaskEvents(backendId, taskId);
  return null;
};

const StatusIcon = ({ status }: { status: TaskStatus }) => {
  switch (status) {
    case TaskStatus.RUNNING:  return <Activity size={16} className="text-blue-500 animate-pulse" />;
    case TaskStatus.DONE:     return <CheckCircle2 size={16} className="text-green-500" />;
    case TaskStatus.FAILED:   return <ShieldAlert size={16} className="text-red-500" />;
    case TaskStatus.STOPPED:  return <StopCircle size={16} className="text-orange-500" />;
    case TaskStatus.PAUSED:   return <PauseCircle size={16} className="text-yellow-500" />;
    default:                  return <Clock size={16} className="text-muted-foreground" />;
  }
};

const getProgressStyles = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.DONE:    return 'bg-green-500/20';
    case TaskStatus.FAILED:  return 'bg-red-500/20';
    case TaskStatus.STOPPED: return 'bg-orange-500/20';
    case TaskStatus.RUNNING: return 'bg-blue-500/20';
    default:                 return 'bg-muted/30';
  }
};

export const SidebarPanel: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const matchTask = useMatch('/task/:id');
  const focusedTaskId = matchTask?.params.id;

  const { isSidebarOpen, activeTab, activeBackendId, activeTaskId, setActiveTaskId, setActiveBackendId } = useAppStore();
  const { data: backends = [] } = useBackends();
  const effectiveBackendId = activeBackendId ?? backends.find(b => b.address)?.id ?? null;
  const { data: tasks = [] } = useTasks(effectiveBackendId);
  const { mutate: deleteBackend } = useDeleteBackend();
  const { mutate: deleteTask } = useDeleteTask();

  const tab = activeTab === 'servers' ? 'backends' : 'tasks';

  const handleSelectTask = (id: string) => { setActiveTaskId(id); setActiveBackendId(null); navigate(`/task/${id}`); };
  const handleSelectBackend = (id: string) => { setActiveBackendId(id); setActiveTaskId(null); navigate(`/server/${id}`); };
  const handleDeleteTask = (id: string, e: React.MouseEvent) => { e.stopPropagation(); if (effectiveBackendId) deleteTask({ backendId: effectiveBackendId, taskId: id }); };
  const handleDeleteBackend = (id: string, e: React.MouseEvent) => { e.stopPropagation(); deleteBackend(id); };

  return (
    <div className={`hidden md:flex h-full shrink-0 overflow-hidden transition-all duration-300 ease-in-out ${isSidebarOpen ? 'w-64' : 'w-0'}`}>
      <div className="w-64 flex flex-col bg-card border-r border-border h-full">
      {/* Action Area */}
      <div className="p-4 border-b border-border">
        {tab === 'tasks' ? (
          <button onClick={() => navigate('/tasks/new')} className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity py-2 px-4 rounded-md text-sm font-semibold shadow-sm active:scale-95">
            <Plus size={16} /><span>{t('sidebar.new_task')}</span>
          </button>
        ) : (
          <button onClick={() => navigate('/servers/new')} className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity py-2 px-4 rounded-md text-sm font-semibold shadow-sm active:scale-95">
            <Plus size={16} /><span>{t('sidebar.add_backend')}</span>
          </button>
        )}
      </div>

      {/* List Area */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 overflow-x-hidden">
        <div className="px-2 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
          {tab === 'tasks' ? t('sidebar.active_tasks') : t('sidebar.configured_engines')}
        </div>

        {tab === 'tasks' ? (
          tasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t('sidebar.no_active_scans')}</div>
          ) : (
            tasks.map((task) => (
              <div key={task.id} onClick={() => handleSelectTask(task.id)} title={task.name}
                className={`group relative flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-all border border-transparent overflow-hidden ${activeTaskId === task.id ? 'bg-accent text-foreground border-border shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
              >
                <div className={`absolute left-0 top-0 bottom-0 transition-all duration-500 pointer-events-none ${getProgressStyles(task.status)}`} style={{ width: `${task.progress}%` }} />
                <div className="relative z-10 flex items-center gap-3 overflow-hidden">
                  <StatusIcon status={task.status} />
                  <div className="flex flex-col truncate">
                    <span className="font-medium text-sm truncate">{task.name}</span>
                    <span className="text-[10px] opacity-60 truncate">{t('sidebar.targets', { count: task.targets.length })} • {task.progress}%</span>
                  </div>
                </div>
                <button onClick={(e) => handleDeleteTask(task.id, e)} className="relative z-10 opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded-md transition-all" title={t('sidebar.delete_task')}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )
        ) : (
          backends.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t('sidebar.no_backends')}</div>
          ) : (
            backends.map((backend) => (
              <div key={backend.id} onClick={() => handleSelectBackend(backend.id)} title={backend.name}
                className={`group flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-all border border-transparent ${activeBackendId === backend.id ? 'bg-accent text-foreground border-border shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="shrink-0 text-blue-500"><Box size={16} /></div>
                  <div className="flex flex-col truncate">
                    <span className="font-medium text-sm truncate">{backend.name}</span>
                    <span className="text-[10px] opacity-60 truncate">{backend.address}</span>
                  </div>
                </div>
                <button onClick={(e) => handleDeleteBackend(backend.id, e)} className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded-md transition-all" title={t('sidebar.delete_backend')}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )
        )}
      </div>

      {/* Background Event Listeners */}
      {tasks.map(task => {
        const isActive = task.status === TaskStatus.RUNNING || task.status === TaskStatus.PENDING;
        const isFocused = task.id === focusedTaskId;
        if (isActive && !isFocused) return <TaskEventListener key={task.id} backendId={effectiveBackendId} taskId={task.id} />;
        return null;
      })}
      </div>
    </div>
  );
};
