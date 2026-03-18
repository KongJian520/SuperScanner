import React from 'react';
import { List, Plus, Server } from 'lucide-react';
import { useNavigate, useMatch } from 'react-router-dom';
import { useAppStore } from '../lib/store';

export const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const { activeTab, setActiveTab } = useAppStore();

  // Hide on detail routes for full-screen UX
  const isTaskDetail = useMatch('/task/:id');
  const isServerDetail = useMatch('/server/:id');
  if (isTaskDetail || isServerDetail) return null;

  const handleTab = (tab: 'tasks' | 'servers') => {
    setActiveTab(tab);
    navigate(tab === 'tasks' ? '/tasks' : '/servers');
  };

  const handleNew = () => {
    navigate(activeTab === 'tasks' ? '/tasks/new' : '/servers/new');
  };

  const btnClass = (tab: 'tasks' | 'servers') =>
    `flex-1 flex flex-col items-center justify-center gap-1 text-xs transition-colors relative ${activeTab === tab ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`;

  const activeIndicator = (tab: 'tasks' | 'servers') =>
    activeTab === tab ? <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-b-full" /> : null;

  return (
    <div className="flex md:hidden fixed bottom-0 left-0 right-0 h-14 bg-card border-t border-border z-50 bottom-nav">
      <button onClick={() => handleTab('tasks')} className={btnClass('tasks')}>
        {activeIndicator('tasks')}
        <List size={20} />
        <span>Tasks</span>
      </button>
      <button onClick={handleNew} className="flex-1 flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <Plus size={20} />
        <span>New</span>
      </button>
      <button onClick={() => handleTab('servers')} className={btnClass('servers')}>
        {activeIndicator('servers')}
        <Server size={20} />
        <span>Servers</span>
      </button>
    </div>
  );
};
