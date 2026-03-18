import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Square, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { isMac, isWindows, isTauri } from '../lib/platform';

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

const WindowControls: React.FC<{ side: 'left' | 'right' }> = ({ side }) => (
  <div className={`flex items-center gap-1.5 z-10 ${side === 'left' ? 'mr-2' : 'ml-2'}`}>
    {isMac ? (
      <>
        <button onClick={() => appWindow?.close()} className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-90 transition-all" title="Close" />
        <button onClick={() => appWindow?.minimize()} className="w-3 h-3 rounded-full bg-[#febc2e] hover:brightness-90 transition-all" title="Minimize" />
        <button onClick={() => appWindow?.toggleMaximize()} className="w-3 h-3 rounded-full bg-[#28c840] hover:brightness-90 transition-all" title="Maximize" />
      </>
    ) : isWindows ? (
      <>
        <button onClick={() => appWindow?.minimize()} className="p-1.5 hover:bg-foreground/10 rounded transition-colors text-muted-foreground hover:text-foreground"><Minus size={13} /></button>
        <button onClick={() => appWindow?.toggleMaximize()} className="p-1.5 hover:bg-foreground/10 rounded transition-colors text-muted-foreground hover:text-foreground"><Square size={11} /></button>
        <button onClick={() => appWindow?.close()} className="p-1.5 hover:bg-red-500/80 rounded transition-colors text-muted-foreground hover:text-white"><X size={13} /></button>
      </>
    ) : (
      <>
        <button onClick={() => appWindow?.minimize()} className="p-1.5 hover:bg-foreground/10 rounded-full transition-colors text-muted-foreground hover:text-foreground"><Minus size={13} /></button>
        <button onClick={() => appWindow?.toggleMaximize()} className="p-1.5 hover:bg-foreground/10 rounded-full transition-colors text-muted-foreground hover:text-foreground"><Square size={11} /></button>
        <button onClick={() => appWindow?.close()} className="p-1.5 hover:bg-red-500/60 rounded-full transition-colors text-muted-foreground hover:text-white"><X size={13} /></button>
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
        className={`px-2.5 py-1 text-xs rounded transition-colors select-none
          ${isOpen ? 'bg-foreground/15 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/8'}`}
      >
        {menu.label}
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-0.5 bg-popover border border-border rounded-md shadow-xl py-1 min-w-[180px] z-[100]">
          {menu.items.map((item, i) =>
            item.label === '---' ? (
              <div key={i} className="my-1 border-t border-border" />
            ) : (
              <button
                key={item.label}
                onClick={() => { item.action?.(); onClose(); }}
                className="w-full px-3 py-1.5 text-xs text-left flex items-center justify-between text-foreground hover:bg-accent transition-colors"
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
        { label: t('menu.tasks'), action: () => navigate('/tasks'), shortcut: `${mod}1` },
        { label: t('menu.servers'), action: () => navigate('/servers'), shortcut: `${mod}2` },
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
    <div
      data-tauri-drag-region
      className="hidden md:flex h-9 bg-card items-center select-none border-b border-border z-50 shrink-0 relative"
    >
      {/* macOS: 窗口控制在左（仅 Tauri 环境，需 decorations:false） */}
      {isTauri && isMac && (
        <div className="flex items-center pl-3 pr-1">
          <WindowControls side="left" />
        </div>
      )}

      {/* 应用图标 + 名称 */}
      <div className="flex items-center gap-1.5 px-3 shrink-0" data-tauri-drag-region>
        <span className="text-xs font-semibold text-foreground/70 tracking-wide">PolyScan Pro</span>
      </div>

      {/* 菜单栏 */}
      <div ref={menuBarRef} className="flex items-center gap-0.5">
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
      <div className="flex-1" data-tauri-drag-region />

      {/* Windows / Linux: 窗口控制在右（仅 Tauri 环境） */}
      {isTauri && !isMac && (
        <div className="flex items-center pr-1">
          <WindowControls side="right" />
        </div>
      )}
    </div>
  );
};
