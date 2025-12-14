import { create } from 'zustand';

interface AppState {
  isSidebarOpen: boolean;
  activeBackendId: string | null;
  activeTaskId: string | null;
  
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActiveBackendId: (id: string | null) => void;
  setActiveTaskId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isSidebarOpen: true,
  activeBackendId: null,
  activeTaskId: null,

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),
  setActiveBackendId: (id) => set({ activeBackendId: id }),
  setActiveTaskId: (id) => set({ activeTaskId: id }),
}));
