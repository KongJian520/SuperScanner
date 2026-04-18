import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type MotionLevel = 'full' | 'reduced';

interface AppState {
  isSidebarOpen: boolean;
  activeBackendId: string | null;
  activeTaskId: string | null;
  activeTab: 'tasks' | 'servers';
  defaultBackendId: string | null;
  motionLevel: MotionLevel;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActiveBackendId: (id: string | null) => void;
  setActiveTaskId: (id: string | null) => void;
  setActiveTab: (tab: 'tasks' | 'servers') => void;
  setDefaultBackendId: (id: string | null) => void;
  setMotionLevel: (level: MotionLevel) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      isSidebarOpen: true,
      activeBackendId: null,
      activeTaskId: null,
      activeTab: 'tasks',
      defaultBackendId: null,
      motionLevel: 'full',

      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      setSidebarOpen: (open) => set({ isSidebarOpen: open }),
      setActiveBackendId: (id) => set({ activeBackendId: id }),
      setActiveTaskId: (id) => set({ activeTaskId: id }),
      setActiveTab: (tab) => set({ activeTab: tab }),
      setDefaultBackendId: (id) => set({ defaultBackendId: id }),
      setMotionLevel: (level) => set({ motionLevel: level }),
    }),
    {
      name: 'superscanner-ui-preferences',
      partialize: (state) => ({
        defaultBackendId: state.defaultBackendId,
        motionLevel: state.motionLevel,
      }),
    },
  ),
);
