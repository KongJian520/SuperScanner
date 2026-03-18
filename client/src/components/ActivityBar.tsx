import React from 'react';
import { useTranslation } from 'react-i18next';
import { List, Moon, Server, Settings, Sun } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { useAppStore } from '../lib/store';
import { isMac } from '../lib/platform';

const mod = isMac ? '⌘' : 'Ctrl+';

// VSCode 风格纯文字 tooltip
const Tooltip: React.FC<{ label: string; shortcut?: string }> = ({ label, shortcut }) => (
  <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 z-50
    bg-popover text-popover-foreground text-xs rounded px-2.5 py-1.5 whitespace-nowrap shadow-lg border border-border
    pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-100 delay-300
    flex items-center gap-2.5">
    <span className="font-medium">{label}</span>
    {shortcut && <span className="text-muted-foreground">{shortcut}</span>}
  </div>
);

export const ActivityBar: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeTab, isSidebarOpen, setActiveTab, setSidebarOpen } = useAppStore();
  const { theme, setTheme } = useTheme();

  const handleTabClick = (tab: 'tasks' | 'servers') => {
    if (activeTab === tab) {
      setSidebarOpen(!isSidebarOpen);
    } else {
      setActiveTab(tab);
      setSidebarOpen(true);
      navigate(tab === 'tasks' ? '/tasks' : '/servers');
    }
  };

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  const tabBtn = (tab: 'tasks' | 'servers', icon: React.ReactNode, label: string, shortcut: string) => {
    const isActive = activeTab === tab;
    return (
      <div key={tab} className="relative group">
        <button
          onClick={() => handleTabClick(tab)}
          className={`
            w-12 h-12 flex items-center justify-center relative transition-colors
            ${isActive
              ? 'text-foreground before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:bg-primary before:rounded-r'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'}
          `}
        >
          {icon}
        </button>
        <Tooltip label={label} shortcut={shortcut} />
      </div>
    );
  };

  return (
    <div className="hidden md:flex w-12 flex-col bg-card border-r border-border h-full shrink-0">
      <div className="flex flex-col flex-1">
        {tabBtn('tasks', <List size={20} />, t('activity_bar.tasks'), `${mod}1`)}
        {tabBtn('servers', <Server size={20} />, t('activity_bar.servers'), `${mod}2`)}
      </div>
      <div className="flex flex-col pb-2">
        {/* 主题切换 */}
        <div className="relative group">
          <button
            onClick={toggleTheme}
            className="w-12 h-12 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <Tooltip label={theme === 'dark' ? t('activity_bar.light_mode') : t('activity_bar.dark_mode')} />
        </div>
        {/* 设置 */}
        <div className="relative group">
          <button className="w-12 h-12 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Settings size={20} />
          </button>
          <Tooltip label={t('activity_bar.settings')} shortcut={`${mod},`} />
        </div>
      </div>
    </div>
  );
};
