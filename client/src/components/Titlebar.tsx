import React from 'react';
import {Menu, Minus, Square, X} from 'lucide-react';
import {Window} from '@tauri-apps/api/window';
import { useAppStore } from '../lib/store';

export const Titlebar: React.FC = () => {
  const { toggleSidebar } = useAppStore();
  const appWindow = new Window('main');

  document
    .getElementById('titlebar-minimize')
    ?.addEventListener('click', () => appWindow.minimize());
  document
    .getElementById('titlebar-maximize')
    ?.addEventListener('click', () => appWindow.toggleMaximize());
  document
    .getElementById('titlebar-close')
    ?.addEventListener('click', () => appWindow.close());
  return (
    <div
      data-tauri-drag-region
      className="h-10 bg-black flex items-center justify-between px-4 select-none border-b border-border z-50 shrink-0 relative"
    >
      {/* Left: Hamburger Toggle */}
      <div className="flex items-center z-10">
        <button
          onClick={toggleSidebar}
          className="p-1.5 bg-black hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-white"
        >
          <Menu size={18} />
        </button>
      </div>

      {/* Center: Title (Absolute Centered) */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm font-medium text-white/80 pointer-events-none"
        data-tauri-drag-region
      >
        <span>PolyScan Pro</span>
      </div>

      {/* Right: Window Controls */}
      <div className="flex items-center gap-2 z-10">
        <button
          onClick={() => appWindow.minimize()}
          className="p-1.5 bg-black hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-white"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="p-1.5 bg-black hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-white"
        >
          <Square size={12} />
        </button>
        <button
          onClick={() => appWindow.close()}
          className="p-1.5 bg-black hover:bg-red-500/80 rounded-md transition-colors text-gray-400 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};