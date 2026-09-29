import { Check, Copy } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { getCounts } from '@/api/entities'
import type { EntityCounts } from '@/api/types'
import type { TabKey } from '@/adddata/fields'
import { AccessRightForm, AccountForm, ActionForm, CustomerForm, EmployeeForm, SessionForm, TransactionForm, type FormProps } from '@/adddata/forms'
import { ImportPanel } from '@/adddata/ImportPanel'
import { useAddLog, type LogEntry } from '@/adddata/log'
import { shortId } from '@/lib/format'
import { timeFormat } from '@/lib/timeline'
import { Page } from './Placeholder'

interface Tab {
  key: TabKey
  label: string
  count?: keyof EntityCounts
}

const GROUPS: { label: string; tabs: Tab[] }[] = [
  {
    label: 'Register',
    tabs: [
      { key: 'customer', label: 'Customer', count: 'customers' },
      { key: 'account', label: 'Account', count: 'accounts' },
      { key: 'employee', label: 'Employee', count: 'employees' },
    ],
  },
  {
    label: 'Record activity',
    tabs: [
      { key: 'tx', label: 'Transaction', count: 'transactions' },
      { key: 'act', label: 'Employee action', count: 'employee_actions' },
      { key: 'session', label: 'Session', count: 'sessions' },
      { key: 'right', label: 'Access right', count: 'access_rights' },
    ],
  },
  { label: 'Bulk', tabs: [{ key: 'import', label: 'Import file' }] },
]

const TAB_KEYS = new Set<string>(GROUPS.flatMap((g) => g.tabs.map((t) => t.key)))
const FORMS: Record<Exclude<TabKey, 'import'>, (props: FormProps) => React.JSX.Element> = {
  customer: CustomerForm,
  account: AccountForm,
  employee: EmployeeForm,
  tx: TransactionForm,
  act: ActionForm,
  session: SessionForm,
  right: AccessRightForm,
}

export function AddData() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('type') ?? ''
  const tab: TabKey = TAB_KEYS.has(raw) ? (raw as TabKey) : 'customer'
  const [counts, setCounts] = useState<EntityCounts | null>(null)

  const refresh = useCallback(() => {
    getCounts()
      .then(setCounts)
      .catch(() => {
        setCounts(null)
      })
  }, [])
  useEffect(refresh, [refresh])

  const goTo = (key: TabKey) => {
    setParams({ type: key })
  }
  const Form = tab === 'import' ? null : FORMS[tab]

  return (
    <Page title="Add data" meta={<p className="text-[13px] text-fg-muted">Everything saved here is real and goes straight to the Graph and the Timeline.</p>}>
      <div className="grid items-start gap-4 lg:grid-cols-[196px_minmax(0,1fr)_300px]">
        <nav
          aria-label="Record type"
          className="flex flex-wrap gap-1 rounded-card border border-line-strong bg-panel p-2 lg:sticky lg:top-4 lg:flex-col lg:flex-nowrap lg:gap-3"
        >
          {GROUPS.map((group) => (
            <div key={group.label} role="group" aria-labelledby={`grp-${group.label}`} className="contents lg:flex lg:flex-col lg:gap-0.5">
              <span id={`grp-${group.label}`} className="sr-only lg:not-sr-only lg:px-2.5 lg:pt-1.5 lg:pb-1 lg:text-xs lg:font-semibold lg:text-fg-subtle">
                {group.label}
              </span>
              {group.tabs.map((t) => {
                const on = t.key === tab
                const n = t.count && counts ? counts[t.count] : null
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-current={on ? 'page' : undefined}
                    onClick={() => {
                      goTo(t.key)
                    }}
                    className={`flex h-9 items-center justify-between gap-2 rounded-md px-2.5 text-left text-[13px] whitespace-nowrap transition-colors duration-150 ${
                      on ? 'bg-selected font-medium text-fg' : 'text-fg-muted hover:bg-raised hover:text-fg'
                    }`}
                  >
                    {t.label}
                    {n !== null && (
                      <>
                        <span aria-hidden="true" className="font-mono text-[11px] text-fg-subtle tabular-nums">
                          {n.toLocaleString('en-IN')}
                        </span>
                        <span className="sr-only">, {n.toLocaleString('en-IN')} saved</span>
                      </>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="min-w-0">{Form ? <Form key={tab} onSaved={refresh} goTo={goTo} /> : <ImportPanel onSaved={refresh} />}</div>

        <SessionLog />
      </div>
    </Page>
  )
}

function SessionLog() {
  const entries = useAddLog((s) => s.entries)
  const clear = useAddLog((s) => s.clear)
  const saved = entries.filter((e) => e.state === 'saved' || e.state === 'partial').length
  return (
    <section
      aria-labelledby="log-heading"
      className="flex flex-col rounded-card border border-line-strong bg-panel lg:sticky lg:top-4 lg:max-h-[calc(100dvh-140px)]"
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-3.5">
        <h2 id="log-heading" className="text-[13px] font-semibold text-fg">
          Saved this session <span className="ml-1 font-mono text-[11px] font-normal text-fg-subtle tabular-nums">{saved}</span>
        </h2>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="rounded px-1.5 py-0.5 text-xs text-fg-muted transition-colors duration-150 hover:bg-raised hover:text-fg"
          >
            Clear list
          </button>
        )}
      </header>
      {entries.length === 0 ? (
        <p className="px-3.5 py-4 text-[13px] text-fg-muted">
          Nothing entered yet in this tab. What you save appears here, newest first, with links to the Graph and the Timeline.
        </p>
      ) : (
        <ol className="min-h-0 overflow-y-auto" aria-live="polite">
          {entries.map((e) => (
            <LogRow key={e.key} entry={e} />
          ))}
        </ol>
      )}
    </section>
  )
}

const STATE_LABEL = { saved: 'saved', partial: 'partly saved', rejected: 'rejected', skipped: 'already saved' } as const
const STATE_TONE = {
  saved: 'text-ok border-ok/35',
  partial: 'text-fg-muted border-line-strong',
  rejected: 'text-danger border-danger/35',
  skipped: 'text-fg-muted border-line-strong',
} as const

function LogRow({ entry }: { entry: LogEntry }) {
  const [copied, setCopied] = useState(false)
  const copy = (id: string) => {
    navigator.clipboard
      .writeText(id)
      .then(() => {
        setCopied(true)
        setTimeout(() => {
          setCopied(false)
        }, 1500)
      })
      .catch(() => {
        setCopied(false)
      })
  }
  return (
    <li className="flex flex-col gap-1 border-b border-line px-3.5 py-2.5 last:border-b-0">
      <div className="flex items-start gap-2">
        <time dateTime={new Date(entry.at).toISOString()} className="mt-px shrink-0 font-mono text-[11px] text-fg-subtle tabular-nums">
          {timeFormat.format(entry.at)}
        </time>
        <span className="min-w-0 flex-1 text-[13px] break-words text-fg">{entry.summary}</span>
        <span className={`shrink-0 rounded border px-1.5 font-mono text-[10.5px] ${STATE_TONE[entry.state]}`}>{STATE_LABEL[entry.state]}</span>
      </div>
      {entry.reason && <p className={`pl-10 text-xs ${entry.state === 'rejected' ? 'text-danger' : 'text-fg-muted'}`}>{entry.reason}</p>}
      {(entry.links?.length ?? 0) > 0 || entry.id ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-10 text-xs">
          {entry.links?.map((l) => (
            <Link key={l.label} to={l.to} className="font-medium text-accent hover:underline">
              {l.label === 'Graph' ? 'Open in Graph' : 'Open Timeline'}
            </Link>
          ))}
          {entry.id && (
            <button
              type="button"
              title={entry.id}
              aria-label={`Copy id ${entry.id}`}
              onClick={() => {
                copy(entry.id ?? '')
              }}
              className="inline-flex items-center gap-1 rounded font-mono text-[11px] text-fg-subtle transition-colors duration-150 hover:text-fg"
            >
              {copied ? <Check aria-hidden="true" className="size-3 text-ok" /> : <Copy aria-hidden="true" className="size-3" />}
              {copied ? 'copied' : shortId(entry.id)}
            </button>
          )}
        </div>
      ) : null}
    </li>
  )
}
