import React, { Suspense, lazy, useEffect } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { AnimatePresence, motion } from 'framer-motion';
import { Titlebar } from './components/Titlebar';
import { ActivityBar } from './components/ActivityBar';
import { SidebarPanel } from './components/SidebarPanel';
import { BottomNav } from './components/BottomNav';
import './App.css';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from './lib/store';
import { isMac } from './lib/platform';
import { routeLite } from './lib/motion';

const TasksOverview = lazy(() => import('./views/TasksOverview'));
const DashboardOverview = lazy(() => import('./views/DashboardOverview'));
const ServersOverview = lazy(() => import('./views/ServersOverview'));
const CreateTaskDialog = lazy(() => import('./components/CreateTaskDialog'));
const TaskDetailRoute = lazy(() => import('./routes/TaskDetailRoute'));
const TaskResultRoute = lazy(() => import('./routes/TaskResultRoute'));
const ServerDetailRoute = lazy(() => import('./routes/ServerDetailRoute'));
const NewBackendDialog = lazy(() => import('./components/NewBackendDialog'));
const SettingsView = lazy(() => import('./views/SettingsView'));

const getMainNavSection = (pathname: string) => {
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/servers') || pathname.startsWith('/server')) return 'servers';
  return 'tasks';
};

const RouteFallback: React.FC = () => (
  <div className="h-full p-6">
    <div className="space-y-4">
      <div className="h-16 rounded-lg bg-card/70 border border-border animate-pulse" />
      <div className="h-40 rounded-xl bg-card/60 border border-border animate-pulse" />
      <div className="h-64 rounded-xl bg-card/60 border border-border animate-pulse" />
    </div>
  </div>
);

const App: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { setActiveTab, setSidebarOpen, isSidebarOpen, motionLevel } = useAppStore();

  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith('/servers') || path.startsWith('/server')) {
      setActiveTab('servers');
    } else {
      setActiveTab('tasks');
    }
  }, [location.pathname, setActiveTab]);

  // 修饰键跟随系统：macOS 用 meta，Windows/Linux 用 ctrl
  const mod = isMac ? 'meta' : 'ctrl';

  // ⌘1 / Ctrl+1 → Dashboard
  useHotkeys(`${mod}+1`, () => { setActiveTab('tasks'); navigate('/dashboard'); }, { preventDefault: true });
  // ⌘2 / Ctrl+2 → Tasks
  useHotkeys(`${mod}+2`, () => { setActiveTab('tasks'); navigate('/tasks'); }, { preventDefault: true });
  // ⌘3 / Ctrl+3 → Servers
  useHotkeys(`${mod}+3`, () => { setActiveTab('servers'); navigate('/servers'); }, { preventDefault: true });
  // ⌘N / Ctrl+N → New Task
  useHotkeys(`${mod}+n`, () => navigate('/tasks/new'), { preventDefault: true });
  // ⌘⇧N / Ctrl+Shift+N → Add Server
  useHotkeys(`${mod}+shift+n`, () => navigate('/servers/new'), { preventDefault: true });
  // ⌘B / Ctrl+B → Toggle Sidebar
  useHotkeys(`${mod}+b`, () => setSidebarOpen(!isSidebarOpen), { preventDefault: true });
  // ⌘, / Ctrl+, → Settings
  useHotkeys(`${mod},`, () => navigate('/settings'), { preventDefault: true });

  const mainNavSection = getMainNavSection(location.pathname);

  return (
    <div className={`flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans selection:bg-blue-500/30 ${motionLevel === 'reduced' ? 'motion-reduced' : ''}`}>
      <Titlebar />

      <div className="flex flex-1 overflow-hidden">
        <ActivityBar />
        <SidebarPanel />

        <main className="flex-1 bg-background relative overflow-hidden flex flex-col pb-14 md:pb-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mainNavSection}
              variants={routeLite.mainNavSwitch}
              initial="initial"
              animate="animate"
              exit="exit"
              className="h-full"
            >
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<DashboardOverview />} />
                  <Route path="/tasks" element={<TasksOverview />} />
                  <Route path="/tasks/new" element={<CreateTaskDialog />} />
                  <Route path="/task/:id" element={<TaskDetailRoute />} />
                  <Route path="/task/:id/results" element={<Navigate to="ports" replace />} />
                  <Route path="/task/:id/results/:section" element={<TaskResultRoute />} />
                  <Route path="/servers" element={<ServersOverview />} />
                  <Route path="/servers/new" element={<NewBackendDialog open={true} onCancel={() => window.history.back()} />} />
                  <Route path="/server/:id" element={<ServerDetailRoute />} />
                  <Route path="/settings" element={<SettingsView />} />
                </Routes>
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <BottomNav />
    </div>
  );
};

export default App;
