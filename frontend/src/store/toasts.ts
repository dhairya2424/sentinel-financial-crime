import { create } from 'zustand'
import type { RiskBand } from '@/api/types'

export interface Toast {
  id: string
  title: string
  band?: RiskBand
  /** Where clicking the toast goes. */
  to?: string
}

interface ToastState {
  toasts: Toast[]
  push: (toast: Omit<Toast, 'id'>) => string
  dismiss: (id: string) => void
}

const MAX_TOASTS = 3

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = crypto.randomUUID()
    set((s) => ({ toasts: [{ ...toast, id }, ...s.toasts].slice(0, MAX_TOASTS) }))
    return id
  },
  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))
