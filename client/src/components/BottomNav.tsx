import React from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, List, Plus, Server, Settings } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '../lib/store';
import { navMotion } from '../lib/motion';

export const BottomNav: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { setActiveTab } = useAppStore();

  const handleTab = (tab: 'tasks' | 'servers', path: string) => {
    setActiveTab(tab);
    navigate(path);
  };

  const handleNew = () => {
    const inServersSection = location.pathname.startsWith('/servers') || location.pathname.startsWith('/server/');
    navigate(inServersSection ? '/servers/new' : '/tasks/new');
  };

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname.startsWith('/dashboard');
    if (path === '/tasks') return location.pathname.startsWith('/tasks') || location.pathname.startsWith('/task/');
    if (path === '/servers') return location.pathname.startsWith('/servers') || location.pathname.startsWith('/server/');
    if (path === '/settings') return location.pathname.startsWith('/settings');
    return false;
  };

  const btnClass = (path: string) =>
    `group flex-1 flex flex-col items-center justify-center gap-1 text-[11px] leading-none transition-[color,background-color,border-color,transform] relative rounded-xl border ${isActive(path) ? 'text-primary bg-primary/10 border-primary/30 shadow-[0_8px_20px_rgba(59,130,246,0.25)]' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/60 hover:border-primary/20 hover:-translate-y-0.5'}`;

  const activeIndicator = (path: string) =>
    <span
      className={`absolute top-1 left-1/2 -translate-x-1/2 w-9 h-0.5 bg-primary rounded-full transition-[opacity,transform] ${isActive(path) ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-75'}`}
      style={{
        transitionDuration: `${navMotion.indicator.durationMs}ms`,
        transitionTimingFunction: navMotion.indicator.easing,
      }}
    />;

  return (
    <div className="flex md:hidden fixed bottom-0 left-0 right-0 h-16 px-2 pb-safe bg-card/92 backdrop-blur-xl border-t border-border/80 z-50 bottom-nav">
      <button
        onClick={() => handleTab('tasks', '/dashboard')}
        className={btnClass('/dashboard')}
        style={{
          transitionDuration: `${navMotion.selection.durationMs}ms`,
          transitionTimingFunction: navMotion.selection.easing,
        }}
      >
        {activeIndicator('/dashboard')}
        <span className={`absolute inset-0 pointer-events-none rounded-xl opacity-0 transition-opacity duration-200 ${isActive('/dashboard') ? 'opacity-100 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.2),transparent_70%)]' : 'group-hover:opacity-100'}`} />
        <LayoutDashboard size={18} />
        <span>{t('activity_bar.dashboard')}</span>
      </button>
      <button
        onClick={() => handleTab('tasks', '/tasks')}
        className={btnClass('/tasks')}
        style={{
          transitionDuration: `${navMotion.selection.durationMs}ms`,
          transitionTimingFunction: navMotion.selection.easing,
        }}
      >
        {activeIndicator('/tasks')}
        <span className={`absolute inset-0 pointer-events-none rounded-xl opacity-0 transition-opacity duration-200 ${isActive('/tasks') ? 'opacity-100 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.2),transparent_70%)]' : 'group-hover:opacity-100'}`} />
        <List size={20} />
        <span>{t('sidebar.tasks')}</span>
      </button>
      <button onClick={handleNew} className="flex-1 flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-[color,transform] active:scale-95">
        <span className="w-9 h-9 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shadow-[0_8px_20px_rgba(59,130,246,0.2)]">
          <Plus size={20} />
        </span>
        <span>{t('common.create')}</span>
      </button>
      <button
        onClick={() => handleTab('servers', '/servers')}
        className={btnClass('/servers')}
        style={{
          transitionDuration: `${navMotion.selection.durationMs}ms`,
          transitionTimingFunction: navMotion.selection.easing,
        }}
      >
        {activeIndicator('/servers')}
        <Server size={20} />
        <span>{t('servers.title')}</span>
      </button>
      <button
        onClick={() => navigate('/settings')}
        className={btnClass('/settings')}
        style={{
          transitionDuration: `${navMotion.selection.durationMs}ms`,
          transitionTimingFunction: navMotion.selection.easing,
        }}
      >
        {activeIndicator('/settings')}
        <Settings size={18} />
        <span>{t('activity_bar.settings')}</span>
      </button>
    </div>
  );
};
