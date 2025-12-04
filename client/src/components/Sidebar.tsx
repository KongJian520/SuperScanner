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
import {BackendConfig, Task, TaskStatus} from '../types';
import {useNavigate, useLocation} from 'react-router-dom';

interface SidebarProps {
  isOpen: boolean;
  tasks: Task[];
  backends: BackendConfig[];
  activeTaskId: string | null;
  activeBackendId: string | null;
  onSelectTask: (id: string) => void;
  onSelectBackend: (id: string) => void;
  onNewTask: () => void;
  onNewBackend: () => void;
  onDeleteTask: (id: string, e: React.MouseEvent) => void;
  onDeleteBackend: (identifier: string, e: React.MouseEvent) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  tasks,
  backends,
  activeTaskId,
  activeBackendId,
  onSelectTask,
  onSelectBackend,
  onNewTask,
  onNewBackend,
  onDeleteTask,
  onDeleteBackend
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  // derive tab from current route: server-related routes -> backends, otherwise tasks
  const path = location.pathname ?? '';
  const tab = path.startsWith('/servers') || path.startsWith('/server') ? 'backends' : 'tasks';

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
    <div className={`${isOpen ? 'w-64' : 'w-20'} bg-card border-r border-border flex flex-col shrink-0 h-full transition-all duration-300 ease-in-out`}>

      {/* Sidebar Mode Tabs */}
      <div className={`flex ${isOpen ? 'flex-row' : 'flex-col'} items-center p-2 gap-1 border-b border-border`}>
        <button
          onClick={() => navigate('/tasks')}
          title="Tasks"
          className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-colors w-full ${tab === 'tasks' ? 'bg-secondary text-white' : 'text-muted-foreground hover:bg-white/5'}`}
        >
          <List size={14} />
          {isOpen && <span>Tasks</span>}
        </button>
        <button
          onClick={() => navigate('/servers')}
          title="Backends"
          className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-colors w-full ${tab === 'backends' ? 'bg-secondary text-white' : 'text-muted-foreground hover:bg-white/5'}`}
        >
          <Server size={14} />
          {isOpen && <span>Backends</span>}
        </button>
      </div>

      {/* Action Area */}
      <div className="p-4 border-b border-border">
        {tab === 'tasks' ? (
          <button
            onClick={onNewTask}
            title="New Scan Task"
            className={`w-full flex items-center justify-center gap-2 bg-white text-black hover:bg-gray-200 transition-colors py-2 px-4 rounded-md text-sm font-semibold shadow-sm`}
          >
            <Plus size={16} />
            {isOpen && <span>New Scan Task</span>}
          </button>
        ) : (
          <button
            onClick={onNewBackend}
            title="Add Backend"
            className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white hover:bg-blue-500 transition-colors py-2 px-4 rounded-md text-sm font-semibold shadow-sm"
          >
            <Plus size={16} />
            {isOpen && <span>Add Backend</span>}
          </button>
        )}
      </div>

      {/* List Area */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 overflow-x-hidden">
        {isOpen && (
          <div className="px-2 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
            {tab === 'tasks' ? 'Active Tasks' : 'Configured Engines'}
          </div>
        )}

        {tab === 'tasks' ? (
          tasks.length === 0 ? (
            <div className={`px-4 py-8 text-center text-sm text-muted-foreground ${!isOpen && 'hidden'}`}>
              No active scans.
            </div>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                title={task.name}
                className={`
                  group relative flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-all border border-transparent overflow-hidden
                  ${activeTaskId === task.id
                    ? 'bg-secondary text-white border-border shadow-sm'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'}
                  ${!isOpen && 'justify-center'}
                `}
              >
                {/* Progress Bar Background with Binary Animation */}
                <div
                  className={`absolute left-0 top-0 bottom-0 transition-all duration-500 ease-out pointer-events-none overflow-hidden ${getProgressStyles(task.status)}`}
                  style={{ width: `${task.progress}%` }}
                >

                </div>

                <div className="flex items-center gap-3 overflow-hidden relative z-10">
                  <StatusIcon status={task.status} />
                  {isOpen && (
                    <div className="flex flex-col truncate">
                      <span className="text-sm font-medium truncate">{task.name}</span>
                      <span className="text-[10px] text-muted-foreground truncate">
                        {(task.targets?.length ?? 0)} targets
                      </span>
                    </div>
                  )}
                </div>

                {isOpen && (
                  <button
                    onClick={(e) => onDeleteTask(task.id, e)}
                    className="relative z-10 opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 hover:text-red-400 rounded transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))
          )
        ) : (
          /* Backends List */
            backends.length === 0 ? (
            <div className={`px-4 py-8 text-center text-sm text-muted-foreground ${!isOpen && 'hidden'}`}>
              No backends configured.
            </div>
          ) : (
            backends.map((backend, idx) => (
              <div
                key={backend.id ?? `${backend.name}-${idx}`}
                onClick={() => onSelectBackend(backend.id)}
                title={backend.name}
                className={`group flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-all border border-transparent
                  ${activeBackendId === backend.id
                    ? 'bg-blue-900/20 text-blue-100 border-blue-500/20'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'}
                  ${!isOpen && 'justify-center'}
                `}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <Box size={16} className="text-blue-500 shrink-0" />
                  {isOpen && (
                    <div className="flex flex-col truncate">
                      <span className="text-sm font-medium truncate">{backend.name}</span>
                    </div>
                  )}
                </div>

                {isOpen && (
                  <button
                    onClick={(e) => onDeleteBackend(backend.id ?? backend.name, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 hover:text-red-400 rounded transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))
          )
        )}
      </div>

      {/* Footer */}
      <div className={`p-4 border-t border-border ${!isOpen && 'flex justify-center'}`}>
        <div
          title="Global Settings"
          className="flex items-center gap-3 text-sm text-muted-foreground hover:text-white cursor-pointer px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors"
        >
          <Settings size={16} />
          {isOpen && <span>Global Settings</span>}
        </div>
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