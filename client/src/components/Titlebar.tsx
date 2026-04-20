import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Minus, Server, Square, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { isMac, isWindows, isTauri } from '../lib/platform';
import { useBackends, useTasks } from '../hooks/use-scanner-api';
import { useAppStore } from '../lib/store';
import { TaskStatus } from '../types';
import { pickEffectiveBackendId } from '../lib/backend-selection';

const getWindow = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Window } = require('@tauri-apps/api/window');
    return new Window('main');
  } catch {
    return null;
  }
};

const appWindow = getWindow();

// 菜单定义
interface MenuItem {
  label: string;
  action?: () => void;
  shortcut?: string;
}
interface Menu {
  label: string;
  items: MenuItem[];
}

const WindowControls: React.FC<{ side: 'left' | 'right'; labels: { close: string; minimize: string; maximize: string } }> = ({ side, labels }) => (
  <div className={`flex items-center gap-1.5 z-10 ${side === 'left' ? 'mr-2' : 'ml-2'}`}>
    {isMac ? (
      <>
        <button onClick={() => appWindow?.close()} className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-90 transition-all hover:scale-110 shadow-[0_0_12px_rgba(255,95,87,0.45)]" title={labels.close} />
        <button onClick={() => appWindow?.minimize()} className="w-3 h-3 rounded-full bg-[#febc2e] hover:brightness-90 transition-all hover:scale-110 shadow-[0_0_12px_rgba(254,188,46,0.45)]" title={labels.minimize} />
        <button onClick={() => appWindow?.toggleMaximize()} className="w-3 h-3 rounded-full bg-[#28c840] hover:brightness-90 transition-all hover:scale-110 shadow-[0_0_12px_rgba(40,200,64,0.45)]" title={labels.maximize} />
      </>
    ) : isWindows ? (
      <>
        <button onClick={() => appWindow?.minimize()} className="p-1.5 hover:bg-cyan-500/15 rounded-md border border-transparent hover:border-cyan-400/35 transition-[color,background-color,border-color,transform] text-muted-foreground hover:text-foreground hover:-translate-y-0.5"><Minus size={13} /></button>
        <button onClick={() => appWindow?.toggleMaximize()} className="p-1.5 hover:bg-cyan-500/15 rounded-md border border-transparent hover:border-cyan-400/35 transition-[color,background-color,border-color,transform] text-muted-foreground hover:text-foreground hover:-translate-y-0.5"><Square size={11} /></button>
        <button onClick={() => appWindow?.close()} className="p-1.5 hover:bg-red-500/80 rounded-md border border-transparent hover:border-red-300/50 transition-[color,background-color,border-color,transform] text-muted-foreground hover:text-white hover:-translate-y-0.5"><X size={13} /></button>
      </>
    ) : (
      <>
        <button onClick={() => appWindow?.minimize()} className="p-1.5 hover:bg-cyan-500/15 rounded-full transition-[color,background-color,transform] text-muted-foreground hover:text-foreground hover:-translate-y-0.5"><Minus size={13} /></button>
        <button onClick={() => appWindow?.toggleMaximize()} className="p-1.5 hover:bg-cyan-500/15 rounded-full transition-[color,background-color,transform] text-muted-foreground hover:text-foreground hover:-translate-y-0.5"><Square size={11} /></button>
        <button onClick={() => appWindow?.close()} className="p-1.5 hover:bg-red-500/60 rounded-full transition-[color,background-color,transform] text-muted-foreground hover:text-white hover:-translate-y-0.5"><X size={13} /></button>
      </>
    )}
  </div>
);

const MenuBarItem: React.FC<{ menu: Menu; isOpen: boolean; onOpen: () => void; onClose: () => void; anyOpen: boolean }> = ({ menu, isOpen, onOpen, onClose, anyOpen }) => {
  return (
    <div className="relative">
      <button
        onClick={() => isOpen ? onClose() : onOpen()}
        onMouseEnter={() => anyOpen && !isOpen && onOpen()}
        className={`px-2.5 py-1 text-xs rounded-md border transition-[color,background-color,border-color,transform] select-none
          ${isOpen ? 'bg-primary/15 text-foreground border-primary/30 shadow-[0_8px_20px_rgba(59,130,246,0.18)]' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-foreground/8 hover:border-primary/20 hover:-translate-y-0.5'}`}
      >
        {menu.label}
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-popover/95 border border-primary/25 rounded-lg shadow-2xl shadow-primary/15 py-1 min-w-[200px] z-[100] backdrop-blur-md">
          {menu.items.map((item, i) =>
            item.label === '---' ? (
              <div key={i} className="my-1 border-t border-border/80" />
            ) : (
              <button
                key={item.label}
                onClick={() => { item.action?.(); onClose(); }}
                className="w-full px-3 py-1.5 text-xs text-left flex items-center justify-between text-foreground hover:bg-accent/80 transition-[background-color,color]"
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="text-muted-foreground ml-6">{item.shortcut}</span>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
};

export const Titlebar: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mod = isMac ? '⌘' : 'Ctrl+';
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const { activeBackendId, defaultBackendId } = useAppStore();
  const { data: backends = [] } = useBackends();
  const effectiveBackendId = pickEffectiveBackendId(backends, activeBackendId, defaultBackendId);
  const { data: tasks = [] } = useTasks(effectiveBackendId);
  const runningTasks = tasks.filter((task) => task.status === TaskStatus.RUNNING).length;

  // 点击菜单栏外部时关闭
  useEffect(() => {
    if (!activeMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activeMenu]);

  const menus: Menu[] = [
    {
      label: t('menu.file'),
      items: [
        { label: t('menu.new_task'), action: () => navigate('/tasks/new'), shortcut: `${mod}N` },
        { label: t('menu.add_server'), action: () => navigate('/servers/new'), shortcut: isMac ? '⌘⇧N' : 'Ctrl+Shift+N' },
        { label: '---' },
        { label: t('menu.close_window'), action: () => appWindow?.close(), shortcut: isMac ? '⌘W' : 'Alt+F4' },
      ],
    },
    {
      label: t('menu.view'),
      items: [
        { label: t('activity_bar.dashboard'), action: () => navigate('/dashboard'), shortcut: `${mod}1` },
        { label: t('menu.tasks'), action: () => navigate('/tasks'), shortcut: `${mod}2` },
        { label: t('menu.servers'), action: () => navigate('/servers'), shortcut: `${mod}3` },
      ],
    },
    {
      label: t('menu.help'),
      items: [
        { label: t('menu.about') },
      ],
    },
  ];

  return (
    <>
      <div className="md:hidden shrink-0 border-b border-border/70 bg-card/90 backdrop-blur-md">
        <div
          className="w-full"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="h-10 px-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(74,222,128,0.75)]" />
              <span className="text-[11px] font-semibold text-foreground/80 tracking-[0.12em] uppercase truncate">{t('app.name')}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-background/50 px-2 text-[10px] text-muted-foreground"
                title={t('titlebar.mobile_running_tasks')}
                aria-label={t('titlebar.mobile_running_tasks')}
              >
                <Activity size={12} className={runningTasks > 0 ? 'text-blue-400 animate-pulse' : 'text-muted-foreground'} />
                <span className="font-medium text-foreground/90">{runningTasks}</span>
              </span>
              <span
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-background/50 px-2 text-[10px] text-muted-foreground"
                title={t('titlebar.mobile_connected_backends')}
                aria-label={t('titlebar.mobile_connected_backends')}
              >
                <Server size={12} className="text-cyan-400" />
                <span className="font-medium text-foreground/90">{backends.length}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        data-tauri-drag-region
        className="hidden md:flex h-9 bg-card/95 items-center select-none border-b border-border/80 z-50 shrink-0 relative backdrop-blur-md overflow-hidden"
      >
        <span className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.2),transparent_72%)]" />
        {/* macOS: 窗口控制在左（仅 Tauri 环境，需 decorations:false） */}
        {isTauri && isMac && (
          <div className="flex items-center pl-3 pr-1 relative z-10">
            <WindowControls
              side="left"
              labels={{
                close: t('titlebar.window_controls.close'),
                minimize: t('titlebar.window_controls.minimize'),
                maximize: t('titlebar.window_controls.maximize'),
              }}
            />
          </div>
        )}

        {/* 应用图标 + 名称 */}
        <div className="flex items-center gap-1.5 px-3 shrink-0 relative z-10" data-tauri-drag-region>
          <span className="text-xs font-semibold text-foreground/75 tracking-[0.12em] uppercase">{t('app.name')}</span>
        </div>

        {/* 菜单栏 */}
        <div ref={menuBarRef} className="flex items-center gap-0.5 relative z-10">
          {menus.map((menu) => (
            <MenuBarItem
              key={menu.label}
              menu={menu}
              isOpen={activeMenu === menu.label}
              onOpen={() => setActiveMenu(menu.label)}
              onClose={() => setActiveMenu(null)}
              anyOpen={activeMenu !== null}
            />
          ))}
        </div>

        {/* 拖拽区域填充 */}
        <div className="flex-1 relative z-10" data-tauri-drag-region />

        {/* Windows / Linux: 窗口控制在右（仅 Tauri 环境） */}
        {isTauri && !isMac && (
          <div className="flex items-center pr-1 relative z-10">
            <WindowControls
              side="right"
              labels={{
                close: t('titlebar.window_controls.close'),
                minimize: t('titlebar.window_controls.minimize'),
                maximize: t('titlebar.window_controls.maximize'),
              }}
            />
          </div>
        )}
      </div>
    </>
  );
};
