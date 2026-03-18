import { create } from 'zustand';

interface AppState {
  isSidebarOpen: boolean;
  activeBackendId: string | null;
  activeTaskId: string | null;
  activeTab: 'tasks' | 'servers';

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActiveBackendId: (id: string | null) => void;
  setActiveTaskId: (id: string | null) => void;
  setActiveTab: (tab: 'tasks' | 'servers') => void;
}

export const useAppStore = create<AppState>((set) => ({
  isSidebarOpen: true,
  activeBackendId: null,
  activeTaskId: null,
  activeTab: 'tasks',

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),
  setActiveBackendId: (id) => set({ activeBackendId: id }),
  setActiveTaskId: (id) => set({ activeTaskId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
