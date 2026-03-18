import React, { useEffect } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Titlebar } from './components/Titlebar';
import { ActivityBar } from './components/ActivityBar';
import { SidebarPanel } from './components/SidebarPanel';
import { BottomNav } from './components/BottomNav';
import './App.css';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import TasksOverview from './views/TasksOverview';
import ServersOverview from './views/ServersOverview';
import CreateTaskDialog from './components/CreateTaskDialog';
import TaskDetailRoute from './routes/TaskDetailRoute';
import ServerDetailRoute from './routes/ServerDetailRoute';
import NewBackendDialog from './components/NewBackendDialog';
import { useAppStore } from './lib/store';
import { isMac } from './lib/platform';

const pageVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' as const } },
  exit:    { opacity: 0, y: -4, transition: { duration: 0.12, ease: 'easeIn' as const } },
};

const PageWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <motion.div
    className="h-full w-full flex flex-col overflow-hidden"
    variants={pageVariants}
    initial="initial"
    animate="animate"
    exit="exit"
  >
    {children}
  </motion.div>
);

const App: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { setActiveTab, setSidebarOpen, isSidebarOpen } = useAppStore();

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

  // ⌘1 / Ctrl+1 → Tasks
  useHotkeys(`${mod}+1`, () => { setActiveTab('tasks'); navigate('/tasks'); }, { preventDefault: true });
  // ⌘2 / Ctrl+2 → Servers
  useHotkeys(`${mod}+2`, () => { setActiveTab('servers'); navigate('/servers'); }, { preventDefault: true });
  // ⌘N / Ctrl+N → New Task
  useHotkeys(`${mod}+n`, () => navigate('/tasks/new'), { preventDefault: true });
  // ⌘⇧N / Ctrl+Shift+N → Add Server
  useHotkeys(`${mod}+shift+n`, () => navigate('/servers/new'), { preventDefault: true });
  // ⌘B / Ctrl+B → Toggle Sidebar
  useHotkeys(`${mod}+b`, () => setSidebarOpen(!isSidebarOpen), { preventDefault: true });

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans selection:bg-blue-500/30">
      <Titlebar />

      <div className="flex flex-1 overflow-hidden">
        <ActivityBar />
        <SidebarPanel />

        <main className="flex-1 bg-background relative overflow-hidden flex flex-col pb-14 md:pb-0">
          <AnimatePresence mode="wait" initial={false}>
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<Navigate to="/tasks" replace />} />
              <Route path="/tasks" element={<PageWrapper><TasksOverview /></PageWrapper>} />
              <Route path="/tasks/new" element={<PageWrapper><CreateTaskDialog /></PageWrapper>} />
              <Route path="/task/:id" element={<PageWrapper><TaskDetailRoute /></PageWrapper>} />
              <Route path="/servers" element={<PageWrapper><ServersOverview /></PageWrapper>} />
              <Route path="/servers/new" element={<PageWrapper><NewBackendDialog open={true} onCancel={() => window.history.back()} /></PageWrapper>} />
              <Route path="/server/:id" element={<PageWrapper><ServerDetailRoute /></PageWrapper>} />
            </Routes>
          </AnimatePresence>
        </main>
      </div>

      <BottomNav />
    </div>
  );
};

export default App;
