import React from 'react';
import { useTranslation } from 'react-i18next';
import { Languages, LayoutDashboard, List, Moon, Server, Settings, Sun } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { useAppStore } from '../lib/store';
import { isMac } from '../lib/platform';
import { navMotion } from '../lib/motion';

const mod = isMac ? '⌘' : 'Ctrl+';

// VSCode 风格纯文字 tooltip
const Tooltip: React.FC<{ label: string; shortcut?: string }> = ({ label, shortcut }) => (
  <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 z-50
    border border-primary/20 bg-card/95 text-popover-foreground text-[11px] rounded-md px-2.5 py-1.5 whitespace-nowrap shadow-2xl shadow-primary/10 backdrop-blur-md
    pointer-events-none opacity-0 group-hover:opacity-100 group-hover:translate-x-0 translate-x-1 transition-all duration-150 delay-200
    flex items-center gap-2.5">
    <span className="font-semibold tracking-wide">{label}</span>
    {shortcut && <span className="text-muted-foreground">{shortcut}</span>}
  </div>
);

export const ActivityBar: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { activeTab, isSidebarOpen, setActiveTab, setSidebarOpen } = useAppStore();
  const { theme, setTheme } = useTheme();

  const handleSectionClick = (section: 'dashboard' | 'tasks' | 'servers') => {
    const nextTab = section === 'servers' ? 'servers' : 'tasks';
    const nextPath = section === 'dashboard' ? '/dashboard' : section === 'tasks' ? '/tasks' : '/servers';
    const isCurrentSection =
      (section === 'dashboard' && location.pathname.startsWith('/dashboard'))
      || (section === 'tasks' && (location.pathname.startsWith('/tasks') || location.pathname.startsWith('/task/')))
      || (section === 'servers' && (location.pathname.startsWith('/servers') || location.pathname.startsWith('/server/')));
    if (isCurrentSection && activeTab === nextTab) {
      setSidebarOpen(!isSidebarOpen);
    } else {
      setActiveTab(nextTab);
      setSidebarOpen(true);
      navigate(nextPath);
    }
  };

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  const toggleLanguage = () => {
    const next = i18n.language.startsWith('zh') ? 'en' : 'zh';
    void i18n.changeLanguage(next);
  };

  const tabBtn = (
    section: 'dashboard' | 'tasks' | 'servers',
    icon: React.ReactNode,
    label: string,
    shortcut: string,
  ) => {
    const isActive =
      (section === 'dashboard' && location.pathname.startsWith('/dashboard'))
      || (section === 'tasks' && (location.pathname.startsWith('/tasks') || location.pathname.startsWith('/task/')))
      || (section === 'servers' && (location.pathname.startsWith('/servers') || location.pathname.startsWith('/server/')));
    return (
      <div key={section} className="relative group">
        <button
          onClick={() => handleSectionClick(section)}
          className={`
            w-12 h-12 flex items-center justify-center relative overflow-hidden rounded-xl mx-1 my-0.5 border border-transparent
            transition-[color,background-color,border-color,box-shadow,transform]
            ${isActive
              ? 'text-foreground bg-primary/15 border-primary/30 shadow-[0_0_20px_rgba(59,130,246,0.22)]'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/60 hover:border-primary/20 hover:-translate-y-0.5'}
          `}
          style={{
            transitionDuration: `${navMotion.selection.durationMs}ms`,
            transitionTimingFunction: navMotion.selection.easing,
          }}
        >
          <span className={`absolute inset-0 opacity-0 transition-opacity duration-200 ${isActive ? 'opacity-100 bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.22),transparent_70%)]' : 'group-hover:opacity-100 bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.16),transparent_70%)]'}`} />
          <span
            className={`absolute left-0.5 top-2 bottom-2 w-0.5 bg-primary rounded-r pointer-events-none transition-[opacity,transform] ${isActive ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-60'}`}
            style={{
              transitionDuration: `${navMotion.indicator.durationMs}ms`,
              transitionTimingFunction: navMotion.indicator.easing,
            }}
          />
          <span className={`relative z-10 transition-transform duration-200 ${isActive ? 'scale-105' : 'group-hover:scale-105 group-active:scale-95'}`}>{icon}</span>
        </button>
        <Tooltip label={label} shortcut={shortcut} />
      </div>
    );
  };

  return (
    <div className="hidden md:flex w-14 flex-col bg-card/95 border-r border-border/80 h-full shrink-0 backdrop-blur-md relative overflow-hidden">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_72%)]" />
      <div className="flex flex-col flex-1 pt-2 relative z-10">
        {tabBtn('dashboard', <LayoutDashboard size={20} />, t('activity_bar.dashboard'), `${mod}1`)}
        {tabBtn('tasks', <List size={20} />, t('activity_bar.tasks'), `${mod}2`)}
        {tabBtn('servers', <Server size={20} />, t('activity_bar.servers'), `${mod}3`)}
      </div>
      <div className="flex flex-col pb-2 relative z-10">
        {/* 语言切换 */}
        <div className="relative group">
          <button
            onClick={toggleLanguage}
            className="w-12 h-12 mx-1 my-0.5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/60 border border-transparent hover:border-primary/20 rounded-xl transition-[color,background-color,border-color,transform] hover:-translate-y-0.5 active:scale-95"
          >
            <Languages size={18} />
          </button>
          <Tooltip
            label={t('activity_bar.language')}
            shortcut={i18n.language.startsWith('zh') ? t('common.chinese') : t('common.english')}
          />
        </div>
        {/* 主题切换 */}
        <div className="relative group">
          <button
            onClick={toggleTheme}
            className="w-12 h-12 mx-1 my-0.5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/60 border border-transparent hover:border-primary/20 rounded-xl transition-[color,background-color,border-color,transform] hover:-translate-y-0.5 active:scale-95"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <Tooltip label={theme === 'dark' ? t('activity_bar.light_mode') : t('activity_bar.dark_mode')} />
        </div>
        {/* 设置 */}
        <div className="relative group">
          <button
            onClick={() => navigate('/settings')}
            className="w-12 h-12 mx-1 my-0.5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/60 border border-transparent hover:border-primary/20 rounded-xl transition-[color,background-color,border-color,transform] hover:-translate-y-0.5 active:scale-95"
          >
            <Settings size={20} />
          </button>
          <Tooltip label={t('activity_bar.settings')} shortcut={`${mod},`} />
        </div>
      </div>
    </div>
  );
};
