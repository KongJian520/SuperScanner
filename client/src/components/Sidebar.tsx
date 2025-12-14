import React from 'react';
import {
    Activity,
    Box,
    CheckCircle2,
    Clock,
    List,
    PauseCircle,
    Plus,
    Server,
    Settings,
    ShieldAlert,
    StopCircle,
    Trash2
} from 'lucide-react';
import { TaskStatus } from '../types';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '../lib/store';
import { useBackends, useTasks, useDeleteBackend, useDeleteTask } from '../hooks/use-scanner-api';

export const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isSidebarOpen, activeBackendId, activeTaskId, setActiveTaskId, setActiveBackendId } = useAppStore();
  
  const { data: backends = [] } = useBackends();
  
  // Determine effective backend for tasks view
  const effectiveBackendId = activeBackendId ?? backends.find(b => b.address)?.id ?? null;
  const { data: tasks = [] } = useTasks(effectiveBackendId);

  const { mutate: deleteBackend } = useDeleteBackend();
  const { mutate: deleteTask } = useDeleteTask();

  // derive tab from current route: server-related routes -> backends, otherwise tasks
  const path = location.pathname ?? '';
  const tab = path.startsWith('/servers') || path.startsWith('/server') ? 'backends' : 'tasks';

  const handleSelectTask = (id: string) => {
    setActiveTaskId(id);
    setActiveBackendId(null);
    navigate(`/task/${id}`);
  };

  const handleSelectBackend = (id: string) => {
    setActiveBackendId(id);
    setActiveTaskId(null);
    navigate(`/server/${id}`);
  };

  const handleNewTask = () => {
    navigate('/tasks/new');
  };

  const handleNewBackend = () => {
    navigate('/servers/new');
  };

  const handleDeleteTask = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (effectiveBackendId) {
        deleteTask({ backendId: effectiveBackendId, taskId: id });
    }
  };

  const handleDeleteBackend = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteBackend(id);
  };

  // Helper to determine progress bar color and content
  const getProgressStyles = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.DONE:
        return 'bg-green-500/20 text-green-500/30'; // Green on success
      case TaskStatus.FAILED:
        return 'bg-red-500/20 text-red-500/30'; // Red on fail
      case TaskStatus.STOPPED:
        return 'bg-orange-500/20 text-orange-500/30'; // Orange on stop
      case TaskStatus.RUNNING:
        return 'bg-blue-500/20 text-blue-500/30'; // Blue running
      case TaskStatus.PENDING:
      default:
        return 'bg-gray-500/10 text-gray-500/10'; // Idle
    }
  };

  return (
    <div className={`${isSidebarOpen ? 'w-64' : 'w-20'} bg-card border-r border-border flex flex-col shrink-0 h-full transition-all duration-300 ease-in-out`}>

      {/* Sidebar Mode Tabs */}
      <div className={`flex ${isSidebarOpen ? 'flex-row' : 'flex-col'} items-center p-2 gap-1 border-b border-border`}>
        <button
          onClick={() => navigate('/tasks')}
          title="Tasks"
          className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-colors w-full ${tab === 'tasks' ? 'bg-secondary text-white' : 'text-muted-foreground hover:bg-white/5'}`}
        >
          <List size={14} />
          {isSidebarOpen && <span>Tasks</span>}
        </button>
        <button
          onClick={() => navigate('/servers')}
          title="Backends"
          className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-colors w-full ${tab === 'backends' ? 'bg-secondary text-white' : 'text-muted-foreground hover:bg-white/5'}`}
        >
          <Server size={14} />
          {isSidebarOpen && <span>Backends</span>}
        </button>
      </div>

      {/* Action Area */}
      <div className="p-4 border-b border-border">
        {tab === 'tasks' ? (
          <button
            onClick={handleNewTask}
            title="New Scan Task"
            className={`w-full flex items-center justify-center gap-2 bg-white text-black hover:bg-gray-200 transition-colors py-2 px-4 rounded-md text-sm font-semibold shadow-sm`}
          >
            <Plus size={16} />
            {isSidebarOpen && <span>New Scan Task</span>}
          </button>
        ) : (
          <button
            onClick={handleNewBackend}
            title="Add Backend"
            className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white hover:bg-blue-500 transition-colors py-2 px-4 rounded-md text-sm font-semibold shadow-sm"
          >
            <Plus size={16} />
            {isSidebarOpen && <span>Add Backend</span>}
          </button>
        )}
      </div>

      {/* List Area */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 overflow-x-hidden">
        {isSidebarOpen && (
          <div className="px-2 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
            {tab === 'tasks' ? 'Active Tasks' : 'Configured Engines'}
          </div>
        )}

        {tab === 'tasks' ? (
          tasks.length === 0 ? (
            <div className={`px-4 py-8 text-center text-sm text-muted-foreground ${!isSidebarOpen && 'hidden'}`}>
              No active scans.
            </div>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                onClick={() => handleSelectTask(task.id)}
                title={task.name}
                className={`
                  group relative flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-all border border-transparent overflow-hidden
                  ${activeTaskId === task.id
                    ? 'bg-secondary text-white border-border shadow-sm'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'}
                  ${!isSidebarOpen && 'justify-center'}
                `}
              >
                {/* Progress Bar Background with Binary Animation */}
                <div
                  className={`absolute left-0 top-0 bottom-0 transition-all duration-500 ease-out pointer-events-none overflow-hidden ${getProgressStyles(task.status)}`}
                  style={{ width: `${task.progress}%` }}
                >

                </div>

                <div className="relative z-10 flex items-center gap-3 overflow-hidden">
                  <StatusIcon status={task.status} />
                  
                  {isSidebarOpen && (
                    <div className="flex flex-col truncate">
                      <span className="font-medium text-sm truncate">{task.name}</span>
                      <span className="text-[10px] opacity-60 truncate">
                        {task.targets.length} targets • {task.progress}%
                      </span>
                    </div>
                  )}
                </div>

                {isSidebarOpen && (
                  <button
                    onClick={(e) => handleDeleteTask(task.id, e)}
                    className="relative z-10 opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded-md transition-all"
                    title="Delete Task"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))
          )
        ) : (
          backends.length === 0 ? (
            <div className={`px-4 py-8 text-center text-sm text-muted-foreground ${!isSidebarOpen && 'hidden'}`}>
              No backends.
            </div>
          ) : (
            backends.map((backend) => (
              <div
                key={backend.id}
                onClick={() => handleSelectBackend(backend.id)}
                title={backend.name}
                className={`
                  group flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-all border border-transparent
                  ${activeBackendId === backend.id
                    ? 'bg-secondary text-white border-border shadow-sm'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'}
                  ${!isSidebarOpen && 'justify-center'}
                `}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="shrink-0 text-blue-500">
                    <Box size={16} />
                  </div>
                  {isSidebarOpen && (
                    <div className="flex flex-col truncate">
                      <span className="font-medium text-sm truncate">{backend.name}</span>
                      <span className="text-[10px] opacity-60 truncate">{backend.address}</span>
                    </div>
                  )}
                </div>

                {isSidebarOpen && (
                  <button
                    onClick={(e) => handleDeleteBackend(backend.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded-md transition-all"
                    title="Delete Backend"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))
          )
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <button className={`flex items-center ${isSidebarOpen ? 'justify-start' : 'justify-center'} gap-3 text-muted-foreground hover:text-white transition-colors w-full`}>
          <Settings size={18} />
          {isSidebarOpen && <span className="text-sm font-medium">Settings</span>}
        </button>
      </div>
    </div>
  );
};

const StatusIcon = ({ status }: { status: TaskStatus }) => {
  switch (status) {
    case TaskStatus.RUNNING:
      return <Activity size={16} className="text-blue-500 animate-pulse" />;
    case TaskStatus.DONE:
      return <CheckCircle2 size={16} className="text-green-500" />;
    case TaskStatus.FAILED:
      return <ShieldAlert size={16} className="text-red-500" />;
    case TaskStatus.STOPPED:
      return <StopCircle size={16} className="text-orange-500" />;
    case TaskStatus.PAUSED:
      return <PauseCircle size={16} className="text-yellow-500" />;
    case TaskStatus.PENDING:
    default:
      return <Clock size={16} className="text-gray-500" />;
  }
};

export default Sidebar;
