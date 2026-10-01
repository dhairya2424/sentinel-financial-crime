import { api } from './client'
import type { RuleRow, RuleUpdate, RuleVersion } from './types'

export const listRules = (signal?: AbortSignal) => api<RuleRow[]>('/v1/rules', { signal })

export const ruleHistory = (code: string, signal?: AbortSignal) => api<RuleVersion[]>(`/v1/rules/${encodeURIComponent(code)}/history`, { signal })

export const updateRule = (code: string, body: RuleUpdate) => api<RuleRow>(`/v1/rules/${encodeURIComponent(code)}`, { method: 'PUT', body })
