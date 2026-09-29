import { newEventId } from '@/api/entities'
import type { IngestEvent } from '@/api/types'
import { groupInr } from './money'

export const MAX_ROWS = 5000
export const BATCH = 500

const KINDS = ['transaction', 'employee_action', 'session', 'access_right'] as const
type Kind = (typeof KINDS)[number]

/** Columns each kind needs before it is worth sending; the server checks everything else and explains what it rejects. */
export const REQUIRED: Record<Kind, readonly string[]> = {
  transaction: ['amount', 'value_ts'],
  employee_action: ['employee_id', 'action_type', 'target_type', 'target_id', 'event_ts'],
  session: ['employee_id', 'started_at'],
  access_right: ['employee_id', 'entitlement', 'granted_at'],
}

/** Every column the ingest contract accepts, per kind (docs/05 §6), shown as the format reference. */
export const COLUMNS: Record<Kind, readonly string[]> = {
  transaction: ['id', 'from_account_id', 'to_account_id', 'amount', 'currency', 'direction', 'channel', 'reference_no', 'status', 'value_ts', 'raw'],
  employee_action: [
    'id',
    'employee_id',
    'session_id',
    'action_type',
    'target_type',
    'target_id',
    'before_state',
    'after_state',
    'ip_address',
    'event_ts',
    'raw',
  ],
  session: ['id', 'employee_id', 'ip_address', 'device', 'started_at', 'ended_at', 'outcome'],
  access_right: ['id', 'employee_id', 'entitlement', 'scope', 'granted_at', 'revoked_at', 'granted_by', 'source'],
}

const JSON_COLUMNS = new Set(['before_state', 'after_state', 'raw'])

export interface ParsedRow {
  /** 1-based record number in the file (the CSV header is not counted). */
  row: number
  event: IngestEvent | null
  error: string | null
  summary: string
}

export class ImportFileError extends Error {}

/** RFC 4180 CSV: quoted cells may hold commas, doubled quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i)
    if (quoted) {
      if (c === '"' && text.charAt(i + 1) === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (quoted) throw new ImportFileError('The file ends inside a quoted cell. Check for a missing closing quote.')
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function fromCsv(text: string): Record<string, unknown>[] {
  const [header, ...body] = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  if (!header) throw new ImportFileError('The file is empty.')
  const names = header.map((h) => h.trim())
  if (!names.includes('kind')) throw new ImportFileError('The first row must be a header with a kind column, plus the columns for each record.')
  return body.map((cells) => {
    const record: Record<string, unknown> = {}
    names.forEach((name, i) => {
      const value = (cells[i] ?? '').trim()
      if (!name || value === '') return
      if (JSON_COLUMNS.has(name)) {
        try {
          record[name] = JSON.parse(value)
        } catch {
          record[name] = { __invalid: value }
        }
      } else record[name] = value
    })
    return record
  })
}

function fromJson(text: string): unknown[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ImportFileError('The file is not valid JSON.')
  }
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && Array.isArray((data as { events?: unknown }).events)) return (data as { events: unknown[] }).events
  throw new ImportFileError('A JSON file must be a list of records, or an object with an events list.')
}

function summarize(r: Record<string, unknown>): string {
  const s = (k: string) => (typeof r[k] === 'string' || typeof r[k] === 'number' ? String(r[k]) : '')
  switch (r.kind) {
    case 'transaction':
      return `Transaction ${s('amount') ? `₹${groupInr(s('amount'))}` : '(no amount)'} ${s('from_account_id') || 'another bank'} → ${s('to_account_id') || 'another bank'}`
    case 'employee_action':
      return `${s('action_type')} by ${s('employee_id')} on ${s('target_id')}`
    case 'session':
      return `Session for ${s('employee_id')}${s('outcome') ? ` (${s('outcome')})` : ''}`
    case 'access_right':
      return `${s('entitlement')} granted to ${s('employee_id')}`
    default:
      return `Record with kind “${s('kind') || 'missing'}”`
  }
}

function check(record: unknown, row: number): ParsedRow {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { row, event: null, error: 'this row is not a record', summary: 'Unreadable row' }
  }
  const r = record as Record<string, unknown>
  const summary = summarize(r)
  if (!KINDS.includes(r.kind as Kind)) {
    return { row, event: null, error: `kind must be one of ${KINDS.join(', ')}`, summary }
  }
  const kind = r.kind as Kind
  const missing = REQUIRED[kind].filter((k) => r[k] === undefined || r[k] === '')
  if (kind === 'transaction' && !r.from_account_id && !r.to_account_id) missing.push('from_account_id or to_account_id')
  if (missing.length) return { row, event: null, error: `missing ${missing.join(', ')}`, summary }
  const badJson = [...JSON_COLUMNS].find((k) => r[k] && typeof r[k] === 'object' && '__invalid' in r[k])
  if (badJson) return { row, event: null, error: `${badJson} is not valid JSON`, summary }
  const unknown = Object.keys(r).filter((k) => k !== 'kind' && !COLUMNS[kind].includes(k))
  if (unknown.length) return { row, event: null, error: `unknown ${unknown.length === 1 ? 'column' : 'columns'} ${unknown.join(', ')}`, summary }
  const event = { ...r, id: typeof r.id === 'string' && r.id ? r.id : newEventId(kind) } as unknown as IngestEvent
  return { row, event, error: null, summary }
}

/** Read a CSV or JSON export into ingest events, flagging rows that cannot be sent as they are. */
export function parseImport(fileName: string, text: string): ParsedRow[] {
  const json = /\.json$/i.test(fileName) || /^\s*[[{]/.test(text)
  const records = json ? fromJson(text) : fromCsv(text)
  if (records.length === 0) throw new ImportFileError('The file has a header but no records.')
  if (records.length > MAX_ROWS)
    throw new ImportFileError(`The file has ${String(records.length)} records. Split it into files of ${String(MAX_ROWS)} or fewer.`)
  return records.map((r, i) => check(r, i + 1))
}
