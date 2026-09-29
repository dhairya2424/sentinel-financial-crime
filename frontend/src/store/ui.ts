import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UiState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
}

export const useUi = create<UiState>()(
  persist((set) => ({ sidebarCollapsed: false, toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })) }), {
    name: 'sentinel-ui',
  }),
)
