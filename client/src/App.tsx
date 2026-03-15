import React from 'react';
import { Titlebar } from './components/Titlebar';
import { Sidebar } from './components/Sidebar';
import './App.css';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import TasksOverview from './views/TasksOverview';
import ServersOverview from './views/ServersOverview';
import CreateTaskDialog from './components/CreateTaskDialog';
import TaskDetailRoute from './routes/TaskDetailRoute';
import ServerDetailRoute from './routes/ServerDetailRoute';
import NewBackendDialog from './components/NewBackendDialog';

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

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans selection:bg-blue-500/30">
      <Titlebar />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <main className="flex-1 bg-zinc-950 relative overflow-hidden flex flex-col">
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
    </div>
  );
};

export default App;
