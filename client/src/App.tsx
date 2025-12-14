import React from 'react';
import { Titlebar } from './components/Titlebar';
import { Sidebar } from './components/Sidebar';
import './App.css';
import { Routes, Route, Navigate } from 'react-router-dom';
import TasksOverview from './views/TasksOverview';
import ServersOverview from './views/ServersOverview';
import CreateTaskDialog from './components/CreateTaskDialog';
import TaskDetailRoute from './routes/TaskDetailRoute';
import ServerDetailRoute from './routes/ServerDetailRoute';
import NewBackendDialog from './components/NewBackendDialog';

const App: React.FC = () => {
  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden font-sans selection:bg-blue-500/30">
      <Titlebar />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <main className="flex-1 bg-zinc-950 relative overflow-hidden flex flex-col transition-all ">
          <Routes>
            <Route path="/" element={<Navigate to="/tasks" replace />} />
            <Route path="/tasks" element={<TasksOverview />} />
            <Route path="/tasks/new" element={<CreateTaskDialog />} />
            <Route path="/task/:id" element={<TaskDetailRoute />} />
            <Route path="/servers" element={<ServersOverview />} />
            <Route path="/servers/new" element={<NewBackendDialog open={true} onCancel={() => window.history.back()} />} />
            <Route path="/server/:id" element={<ServerDetailRoute />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};

export default App;
