import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemePreference = 'system' | 'light' | 'dark'

interface ThemeState {
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
}

export const useTheme = create<ThemeState>()(
  persist((set) => ({ preference: 'system', setPreference: (preference) => set({ preference }) }), {
    name: 'sentinel-theme',
  }),
)

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  return darkQuery().matches ? 'dark' : 'light'
}

export function useThemeSync(): void {
  const preference = useTheme((s) => s.preference)
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(preference)
    }
    apply()
    if (preference !== 'system') return
    const mq = darkQuery()
    mq.addEventListener('change', apply)
    return () => {
      mq.removeEventListener('change', apply)
    }
  }, [preference])
}
