import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { LoginResponse, User } from '@/api/types'

// Demo trade-off (P0-B): both tokens live in memory and in localStorage so a demo survives a reload.
// Any script on this origin can read localStorage, so production should move the refresh token
// into an httpOnly cookie (docs/08 §3).

export type SignOutReason = 'expired' | 'signed_out'

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  signOutReason: SignOutReason | null
  setAuth: (response: LoginResponse) => void
  setUser: (user: User) => void
  setAccessToken: (token: string) => void
  clear: (reason?: SignOutReason) => void
  isLoggedIn: () => boolean
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      signOutReason: null,
      setAuth: (r) =>
        set({ user: r.user, accessToken: r.access_token, refreshToken: r.refresh_token, signOutReason: null }),
      setUser: (user) => set({ user }),
      setAccessToken: (accessToken) => set({ accessToken }),
      clear: (reason = 'signed_out') =>
        set({ user: null, accessToken: null, refreshToken: null, signOutReason: reason }),
      isLoggedIn: () => get().accessToken !== null,
    }),
    {
      name: 'sentinel-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken }),
    },
  ),
)
