import React, { useEffect, useState } from 'react';
import { Titlebar } from './components/Titlebar';
import { Sidebar } from './components/Sidebar';
import { BackendConfig, Task } from './types';
import * as api from './lib/api';
import { toast } from 'sonner';
import NewBackendDialog from './components/NewBackendDialog';
import './App.css';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import TasksOverview from './views/TasksOverview';
import ServersOverview from './views/ServersOverview';
import CreateTaskDialog from './components/CreateTaskDialog';
import TaskDetailRoute from './routes/TaskDetailRoute';
import ServerDetailRoute from './routes/ServerDetailRoute';

const App: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [backends, setBackends] = useState<BackendConfig[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeBackendId, setActiveBackendId] = useState<string | null>(null);

  // UI State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  // New backend dialog state
  const [isSubmittingNewBackend, setIsSubmittingNewBackend] = useState(false);
  const [newBackendError, setNewBackendError] = useState<string | null>(null);

  // Load backends on mount
  useEffect(() => {
    (async () => {
      const res = await api.getBackends();
      if (res.ok) {
        setBackends(res.data);
      } else {
        console.error('Failed to load backends', res.error);
        toast.error('加载后端失败：' + res.error);
      }
    })();
  }, []);

  // Create task parent-controlled submission state
  const [isSubmittingCreateTask, setIsSubmittingCreateTask] = useState(false);
  const [createTaskError, setCreateTaskError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const handleCreateTaskSubmit = async (payload: { name: string; description?: string; targets: string[]; backendId?: string | null; options?: Record<string, any> }) => {
    setIsSubmittingCreateTask(true);
    setCreateTaskError(null);
    try {
      // resolve backend address from backendId
      const backendId = payload.backendId ?? null;
      if (!backendId) {
        const err = '未选择后端引擎，请先选择一个后端';
        toast.error(err);
        setCreateTaskError(err);
        return { ok: false, error: err } as any;
      }

      const found = backends.find(b => b.id === backendId);
      if (!found || !found.address) {
        const err = '找不到后端地址或后端未配置地址';
        toast.error(err);
        setCreateTaskError(err);
        return { ok: false, error: err } as any;
      }

      const address = found.address;
      const input = {
        name: payload.name,
        description: payload.description,
        targets: payload.targets,
      };

      // useTls persisted on backend record (if present)
      const useTls = !!found.useTls;
      const res = await api.createScanTask(address, input, useTls);
      if (!res.ok) {
        setCreateTaskError(res.error);
        toast.error('创建任务失败：' + res.error);
        return res;
      }

      const newTask = res.data as any;
      // attach backendId to task so later start/stop can resolve address
      const taskWithBackend = { ...newTask, backendId: found.id } as Task;
      setTasks(prev => [taskWithBackend, ...prev]);
      setActiveTaskId(newTask.id);
      // navigate to the new task detail route
      navigate(`/task/${newTask.id}`);
      toast.success('任务已创建');
      return res;
    } finally {
      setIsSubmittingCreateTask(false);
    }
  };

  // --- Task Handlers ---

  const handleNewTask = () => {
    // navigate to dialog route for creating a task
    navigate('/tasks/new');
    setActiveTaskId(null);
    setActiveBackendId(null);
  };

  const handleSelectTask = (id: string) => {
    setActiveTaskId(id);
    setActiveBackendId(null);
    navigate(`/task/${id}`);
  };

  const handleUpdateTask = (updated: Partial<Task>) => {
    if (!activeTaskId) return;
    setTasks(prev => prev.map(t =>
      t.id === activeTaskId ? { ...t, ...updated } : t
    ));
  };

  const handleDeleteTask = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // find task
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    // if task has backendId and we have backend info, attempt remote delete first
    const backendId = task.backendId ?? null;
    if (backendId) {
      const backend = backends.find(b => b.id === backendId);
      if (backend && backend.address) {
        const res = await api.deleteTask(backend.address, id, !!backend.useTls);
        if (!res.ok) {
          toast.error('删除远程任务失败：' + res.error);
          console.error('Failed to delete remote task', res.error);
          return;
        }
        // remote delete succeeded -> remove locally
        setTasks(prev => prev.filter(t => t.id !== id));
        if (activeTaskId === id) setActiveTaskId(null);
        toast.success('已删除远程任务');
        return;
      }
    }

    // fallback: local-only delete
    setTasks(prev => prev.filter(t => t.id !== id));
    if (activeTaskId === id) {
      setActiveTaskId(null);
    }
  };

  // --- Backend Handlers ---

  const handleNewBackend = () => {
    // navigate to backend create dialog route
    navigate('/servers/new');
  };

  const handleSubmitNewBackend = async (payload: { name: string; address: string; description?: string | null; useTls: boolean }) => {
    setIsSubmittingNewBackend(true);
    setNewBackendError(null);
    try {
      const addRes = await api.addBackendWithProbe({ name: payload.name, address: payload.address, description: payload.description ?? null, useTls: payload.useTls });
      if (!addRes.ok) {
        setNewBackendError(addRes.error);
        toast.error('添加后端失败：' + addRes.error);
        return;
      }

      const refreshed = await api.getBackends();
      if (!refreshed.ok) {
        toast.error('刷新后端列表失败：' + refreshed.error);
        setNewBackendError(refreshed.error);
        return;
      }
      setBackends(refreshed.data);
      const found = refreshed.data.find(b => b.name === payload.name);
      setActiveBackendId(found?.id ?? null);
      setActiveTaskId(null);
      // setViewMode('backend_detail');
      toast.success(`已添加后端 ${payload.name}`);
      // navigate to the newly added backend detail (this will also close the /servers/new dialog route)
      if (found?.id) {
        navigate(`/server/${found.id}`);
      } else {
        navigate('/servers');
      }
      // no local dialog state used; routes control dialog visibility
    } finally {
      setIsSubmittingNewBackend(false);
    }
  };

  const handleSelectBackend = (id: string) => {
    setActiveBackendId(id);
    setActiveTaskId(null);
    navigate(`/server/${id}`);
  };

  const handleDeleteBackend = async (identifier: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await api.deleteBackend(identifier);
      if (!res.ok) {
        toast.error('删除后端失败：' + res.error);
        console.error('Failed to delete backend', res.error);
        return;
      }
      setBackends(prev => prev.filter(b => b.id !== identifier));
      const removedMatchesActive = activeBackendId === identifier;
      if (removedMatchesActive) {
        setActiveBackendId(null);
        // setViewMode('empty');
      }
      toast.success('已删除后端');
    } catch (err) {
      console.error("Failed to delete backend", err);
      toast.error('删除后端出错');
    }
  };

  // When visiting /tasks, refresh the task list from the selected backend (or first configured backend)
  useEffect(() => {
    (async () => {
      if (!location.pathname.startsWith('/tasks')) return;
      // choose backend: prefer activeBackendId, otherwise first available with address
      let backend = null as BackendConfig | null;
      if (activeBackendId) backend = backends.find(b => b.id === activeBackendId) ?? null;
      if (!backend) backend = backends.find(b => b.address) ?? null;
      if (!backend || !backend.address) {
        // nothing to fetch
        return;
      }
      const res = await api.listTasks(backend.address, !!backend.useTls);
      if (!res.ok) {
        toast.error('加载任务列表失败：' + res.error);
        return;
      }
      // overwrite tasks with server data and attach backendId so TaskDetail can resolve address
      setTasks(res.data.map(t => ({ ...t, backendId: backend!.id })));
    })();
  }, [location.pathname, backends, activeBackendId]);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans selection:bg-blue-500/30">
      <Titlebar onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          isOpen={isSidebarOpen}
          tasks={tasks}
          backends={backends}
          activeTaskId={activeTaskId}
          activeBackendId={activeBackendId}
          onSelectTask={handleSelectTask}
          onSelectBackend={handleSelectBackend}
          onNewTask={handleNewTask}
          onNewBackend={handleNewBackend}
          onDeleteTask={handleDeleteTask}
          onDeleteBackend={handleDeleteBackend}
        />

        <main className="flex-1 bg-zinc-950 relative overflow-hidden flex flex-col transition-all ">
          <Routes>
            <Route path="/" element={<Navigate to="/tasks" replace />} />
            <Route path="/tasks" element={<TasksOverview tasks={tasks} onSelectTask={handleSelectTask} onDeleteTask={handleDeleteTask} />} />
            <Route path="/tasks/new" element={<CreateTaskDialog availableBackends={backends} onSubmit={handleCreateTaskSubmit} isSubmitting={isSubmittingCreateTask} error={createTaskError} />} />
            <Route path="/task/:id" element={<TaskDetailRoute tasks={tasks} onUpdate={handleUpdateTask} backends={backends} />} />
            <Route path="/servers" element={<ServersOverview backends={backends} onSelectBackend={handleSelectBackend} onDeleteBackend={handleDeleteBackend} onNewBackend={handleNewBackend} />} />
            <Route path="/servers/new" element={<NewBackendDialog open={true} onSubmit={handleSubmitNewBackend} onCancel={() => navigate('/servers')} isSubmitting={isSubmittingNewBackend} error={newBackendError} />} />
            <Route path="/server/:id" element={<ServerDetailRoute backends={backends} />} />
          </Routes>
        </main>
      </div>

    </div>
  );
};

export default App;
