import { ChevronDown, LoaderCircle } from 'lucide-react'
import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listRules, ruleHistory, updateRule } from '@/api/rules'
import type { RuleParamValue, RuleRow, RuleUpdate, RuleVersion } from '@/api/types'
import { ErrorRetry } from '@/components/ErrorRetry'
import { SkeletonRows } from '@/components/Skeleton'
import { ago } from '@/lib/format'
import { describeFixed, fmtParam, fmtWeight, moveWeight, PARAM_META, paramKind, paramLabel, parseParam, weightSum } from '@/lib/rules'
import { useToasts } from '@/store/toasts'
import { Page } from './Placeholder'

/** Neutral ink steps, the same ones the alert's score bar uses: a weight is a share of a score, not a risk colour. */
const INK = ['bg-fg', 'bg-fg-muted', 'bg-fg-subtle', 'bg-line-strong']
const STEP = 0.01
const BIG_STEP = 0.05
/** The settings each row shows as a one-line summary beside its bar. */
const SUMMARY: Record<string, string[]> = {
  'R-CIRC': ['window_hours', 'min_cycle_amount'],
  'R-STRUCT': ['reporting_threshold', 'min_in_band'],
  'R-PROFILE_ROLE': ['revocation_window_hours', 'business_hours'],
  'R-PROFILE_FLOW': ['correlation_window_hours', 'flow_amount_ratio'],
  'R-VELOCITY': ['cap', 'ratio_trigger'],
  'R-OFFHOURS': ['cap', 'start', 'end'],
  'R-DORMANT': ['cap', 'idle_days'],
}

type Load = { status: 'loading' } | { status: 'ready'; rules: RuleRow[] } | { status: 'error'; message: string }

interface Draft {
  enabled: boolean
  weights: number[]
  /** Text as typed, per editable setting; parsed on save. */
  params: Record<string, string>
}

interface Pending {
  rule: RuleRow
  body: RuleUpdate
  errors: Record<string, string>
  count: number
}

const toText = (v: RuleParamValue) => (typeof v === 'number' || typeof v === 'string' ? String(v) : '')
const editable = (rule: RuleRow) => Object.entries(rule.params).filter(([, v]) => paramKind(v) !== 'fixed')

function draftOf(rule: RuleRow): Draft {
  return {
    enabled: rule.enabled,
    weights: Object.values(rule.weights),
    params: Object.fromEntries(editable(rule).map(([k, v]) => [k, toText(v)])),
  }
}

/** The change a draft makes to its rule, as the PUT body, plus any setting that cannot be read. */
function changesOf(rule: RuleRow, draft: Draft): Pending {
  const body: RuleUpdate = {}
  const errors: Record<string, string> = {}
  let count = 0
  const params: Record<string, RuleParamValue> = {}
  for (const [key, original] of editable(rule)) {
    const parsed = parseParam(paramKind(original), draft.params[key] ?? toText(original))
    if (parsed.error) {
      errors[key] = parsed.error
    } else if (parsed.value !== undefined && parsed.value !== original) {
      params[key] = parsed.value
      count += 1
    }
  }
  if (Object.keys(params).length) body.params = params
  const keys = Object.keys(rule.weights)
  if (draft.weights.some((w, i) => w !== rule.weights[keys[i] ?? ''])) {
    body.weights = Object.fromEntries(keys.map((k, i) => [k, draft.weights[i] ?? 0]))
    count += 1
  }
  if (draft.enabled !== rule.enabled) {
    body.enabled = draft.enabled
    count += 1
  }
  return { rule, body, errors, count }
}

/**
 * Admin / Rules (PRD F-13, docs/03 §10): tune detection without code. Each rule is one row whose factor weights are a
 * bar of shares that always totals 1.000; drag a divider (or focus it and use the arrow keys) to move weight between
 * two neighbouring factors. Saving writes each changed rule as a new version (PUT /v1/rules/{code}), which detection
 * uses from the next event, and every version keeps who changed what.
 */
export function RulesPage() {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [historyKey, setHistoryKey] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const push = useToasts((s) => s.push)

  useEffect(() => {
    const controller = new AbortController()
    listRules(controller.signal)
      .then((rules) => {
        setLoad({ status: 'ready', rules })
        setDrafts(Object.fromEntries(rules.map((r) => [r.code, draftOf(r)])))
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      controller.abort()
    }
  }, [attempt])

  const rules = useMemo(() => (load.status === 'ready' ? load.rules : []), [load])
  const pending = useMemo(
    () =>
      rules.flatMap((rule) => {
        const draft = drafts[rule.code]
        if (!draft) return []
        const p = changesOf(rule, draft)
        return p.count > 0 || Object.keys(p.errors).length > 0 ? [p] : []
      }),
    [rules, drafts],
  )
  const invalid = pending.some((p) => Object.keys(p.errors).length > 0)
  const changeCount = pending.reduce((s, p) => s + p.count, 0)
  const changedRules = pending.filter((p) => p.count > 0).length

  // Unsaved weights are easy to lose with a stray reload, so the browser asks first.
  useEffect(() => {
    if (!changeCount) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
    }
  }, [changeCount])

  const setDraft = useCallback((code: string, next: (d: Draft) => Draft) => {
    setDrafts((all) => {
      const d = all[code]
      return d ? { ...all, [code]: next(d) } : all
    })
  }, [])

  const discard = () => {
    setDrafts(Object.fromEntries(rules.map((r) => [r.code, draftOf(r)])))
    setRowErrors({})
  }

  const save = async () => {
    if (invalid || !changeCount) return
    setSaving(true)
    const errors: Record<string, string> = {}
    let updated = rules
    for (const p of pending) {
      if (!p.count) continue
      try {
        const row = await updateRule(p.rule.code, p.body)
        updated = updated.map((r) => (r.code === row.code ? row : r))
        setDrafts((all) => ({ ...all, [row.code]: draftOf(row) }))
        push({ title: `Saved ${row.code} as version ${String(row.version)}` })
      } catch (err) {
        errors[p.rule.code] = err instanceof Error ? err.message : String(err)
      }
    }
    setLoad({ status: 'ready', rules: updated })
    setRowErrors(errors)
    setHistoryKey((k) => k + 1)
    setSaving(false)
  }

  const groupProps = { drafts, open, onOpen: setOpen, setDraft, pending, rowErrors, historyKey }

  return (
    <Page
      title="Admin / Rules"
      meta={<p className="text-[13px] text-fg-muted">Detection settings for this bank. Each save becomes a new version that applies from the next event.</p>}
    >
      {load.status === 'error' && (
        <ErrorRetry
          title="The rules could not be loaded"
          message={load.message}
          onRetry={() => {
            setLoad({ status: 'loading' })
            setAttempt((a) => a + 1)
          }}
        />
      )}
      {load.status === 'loading' && <SkeletonRows rows={7} label="Loading rules" />}
      {load.status === 'ready' && (
        <>
          <div role="region" aria-label="Unsaved changes" className="sticky top-0 z-10 -my-2 flex flex-wrap items-center gap-3 border-b border-line bg-canvas py-2">
            <p className="min-w-0 flex-1 font-mono text-xs text-fg-muted" aria-live="polite" data-testid="rules-status">
              {invalid
                ? 'Fix the highlighted settings to save'
                : changeCount
                  ? `${String(changeCount)} change${changeCount === 1 ? '' : 's'} in ${String(changedRules)} rule${changedRules === 1 ? '' : 's'} · each saves as a new version`
                  : 'All rules saved'}
            </p>
            <button
              type="button"
              onClick={discard}
              disabled={!pending.length || saving}
              className="inline-flex h-8 items-center rounded-md border border-line-strong bg-panel px-3 text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
            >
              Discard changes
            </button>
            <button
              type="button"
              onClick={() => {
                void save()
              }}
              disabled={!changeCount || invalid || saving}
              className="inline-flex h-8 items-center gap-2 rounded-md bg-accent-fill px-3.5 text-[13px] font-semibold text-on-accent transition-colors duration-150 hover:bg-accent-fill-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />}
              {saving ? 'Saving' : changedRules ? `Save ${String(changedRules)} rule${changedRules === 1 ? '' : 's'}` : 'Save'}
            </button>
          </div>

          <RuleGroup
            title="Primary rules"
            sub="Each raises its own alert. The bar is how its score is built: drag a divider to move weight between two factors."
            rules={rules.filter((r) => r.kind === 'primary')}
            {...groupProps}
          />
          <RuleGroup
            title="Supporting rules"
            sub="These add points to an alert on the same people or accounts, and raise an alert of their own only at the score set here."
            rules={rules.filter((r) => r.kind === 'supporting')}
            {...groupProps}
          />
        </>
      )}
    </Page>
  )
}

interface GroupProps {
  title: string
  sub: string
  rules: RuleRow[]
  drafts: Record<string, Draft>
  open: string | null
  onOpen: (code: string | null) => void
  setDraft: (code: string, next: (d: Draft) => Draft) => void
  pending: Pending[]
  rowErrors: Record<string, string>
  historyKey: number
}

function RuleGroup({ title, sub, rules, drafts, open, onOpen, setDraft, pending, rowErrors, historyKey }: GroupProps) {
  const id = `group-${title.split(' ')[0]?.toLowerCase() ?? 'rules'}`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <header className="flex flex-col gap-0.5">
        <h2 id={id} className="text-[13px] font-semibold text-fg">
          {title}
        </h2>
        <p className="max-w-[72ch] text-xs text-fg-subtle">{sub}</p>
      </header>
      <ul className="overflow-hidden rounded-card border border-line-strong bg-panel">
        {rules.map((rule) => {
          const draft = drafts[rule.code]
          if (!draft) return null
          const p = pending.find((x) => x.rule.code === rule.code)
          return (
            <RuleItem
              key={rule.code}
              rule={rule}
              draft={draft}
              open={open === rule.code}
              onToggle={() => {
                onOpen(open === rule.code ? null : rule.code)
              }}
              setDraft={(next) => {
                setDraft(rule.code, next)
              }}
              fieldErrors={p?.errors ?? {}}
              changes={p?.count ?? 0}
              saveError={rowErrors[rule.code]}
              historyKey={historyKey}
            />
          )
        })}
      </ul>
    </section>
  )
}

interface ItemProps {
  rule: RuleRow
  draft: Draft
  open: boolean
  onToggle: () => void
  setDraft: (next: (d: Draft) => Draft) => void
  fieldErrors: Record<string, string>
  changes: number
  saveError?: string
  historyKey: number
}

function RuleItem({ rule, draft, open, onToggle, setDraft, fieldErrors, changes, saveError, historyKey }: ItemProps) {
  const factors = Object.keys(rule.weights)
  const off = !draft.enabled
  const panelId = `rule-panel-${rule.code}`
  const summary = (SUMMARY[rule.code] ?? []).flatMap((k) => {
    const original = rule.params[k]
    if (original === undefined) return []
    const parsed = parseParam(paramKind(original), draft.params[k] ?? toText(original))
    return [fmtParam(k, parsed.value ?? original)]
  })

  return (
    <li className="border-b border-line last:border-b-0" data-testid={`rule-${rule.code}`}>
      <div className="grid gap-x-5 gap-y-3 px-4 py-3.5 lg:grid-cols-[13rem_minmax(0,1fr)_25rem] lg:items-center">
        <div className={`flex min-w-0 flex-col gap-0.5 ${off ? 'text-fg-subtle' : 'text-fg'}`}>
          <span className="font-mono text-xs">{rule.code}</span>
          <span className="text-[13px] font-medium">{rule.name}</span>
          <VersionLine rule={rule} changes={changes} />
        </div>

        {factors.length > 1 ? (
          <WeightBar
            code={rule.code}
            factors={factors}
            weights={draft.weights}
            dimmed={off}
            onChange={(weights) => {
              setDraft((d) => ({ ...d, weights }))
            }}
          />
        ) : (
          <p className={`text-[13px] ${off ? 'text-fg-subtle' : 'text-fg-muted'}`}>
            One factor, <span className="font-mono text-xs text-fg">{factors[0]}</span>, adding at most{' '}
            <span className="font-mono text-xs text-fg tabular-nums">{String(Math.round(Number(rule.params.cap ?? 0) * 100))}</span> points to an alert.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:justify-end">
          <span className="font-mono text-xs whitespace-nowrap text-fg-muted tabular-nums">{summary.join(' · ')}</span>
          <EnabledSwitch
            code={rule.code}
            on={draft.enabled}
            onChange={(on) => {
              setDraft((d) => ({ ...d, enabled: on }))
            }}
          />
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-raised"
          >
            Settings &amp; history
            <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
      {saveError && (
        <p role="alert" className="px-4 pb-3 text-[13px] text-danger">
          {rule.code} was not saved: {saveError}
        </p>
      )}
      {open && (
        <div id={panelId} className="grid gap-6 border-t border-line bg-canvas px-4 py-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Settings rule={rule} draft={draft} setDraft={setDraft} errors={fieldErrors} />
          <History code={rule.code} reloadKey={historyKey} />
        </div>
      )}
    </li>
  )
}

function VersionLine({ rule, changes }: { rule: RuleRow; changes: number }) {
  const [now] = useState(() => Date.now())
  const who = rule.updated_by_name ?? (rule.version === 0 ? 'built-in default' : rule.updated_by ? rule.updated_by : 'seeded')
  return (
    <span className="font-mono text-[11px] text-fg-subtle">
      v{rule.version} · {who}
      {rule.updated_at && ` · ${ago(now - new Date(rule.updated_at).getTime())}`}
      {changes > 0 && <span className="text-fg"> · unsaved, becomes v{rule.version + 1}</span>}
    </span>
  )
}

function EnabledSwitch({ code, on, onChange }: { code: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${code} detects`}
      onClick={() => {
        onChange(!on)
      }}
      className="inline-flex h-8 items-center gap-2 rounded-md px-1.5 text-[13px] text-fg-muted transition-colors duration-150 hover:bg-raised hover:text-fg"
    >
      <span aria-hidden="true" className={`relative h-3.5 w-6.5 rounded-full transition-colors duration-150 ${on ? 'bg-fg' : 'bg-line-strong'}`}>
        <span className={`absolute top-0.5 left-0.5 size-2.5 rounded-full bg-panel transition-transform duration-150 ${on ? 'translate-x-3' : ''}`} />
      </span>
      {on ? 'On' : 'Off'}
    </button>
  )
}

interface BarProps {
  code: string
  factors: string[]
  weights: number[]
  dimmed: boolean
  onChange: (weights: number[]) => void
}

/**
 * The signature control: a factor's weight is its share of the bar. Each divider is a slider between two neighbours;
 * dragging it, or pressing ← → (Shift for 0.05), moves weight from one to the other, so the total stays exactly 1.000.
 */
function WeightBar({ code, factors, weights, dimmed, onChange }: BarProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const latest = useRef(weights)
  useEffect(() => {
    latest.current = weights
  }, [weights])
  const starts = weights.map((_, i) => weights.slice(0, i + 1).reduce((s, w) => s + w, 0))

  const onKey = (i: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? BIG_STEP : STEP
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(moveWeight(weights, i, step))
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(moveWeight(weights, i, -step))
    else return
    e.preventDefault()
  }

  const onPointerDown = (i: number) => (e: PointerEvent<HTMLDivElement>) => {
    const bar = barRef.current
    if (!bar) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    handle.focus()
    const rect = bar.getBoundingClientRect()
    const move = (ev: globalThis.PointerEvent) => {
      const w = latest.current
      const before = w.slice(0, i).reduce((s, x) => s + x, 0)
      const target = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width))
      onChange(moveWeight(w, i, Math.round((target - (before + (w[i] ?? 0))) * 100) / 100))
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${dimmed ? 'opacity-60' : ''}`}>
      <div ref={barRef} role="group" aria-label={`${code} factor weights`} className="relative flex h-7 touch-none rounded-md border border-line-strong bg-canvas select-none">
        {weights.map((w, i) => (
          <span
            key={factors[i]}
            title={`${factors[i] ?? ''}: ${fmtWeight(w)}`}
            className={`h-full first:rounded-l-[5px] last:rounded-r-[5px] not-last:shadow-[inset_-2px_0_0_var(--color-panel)] ${INK[i] ?? 'bg-raised'}`}
            style={{ width: `${String(w * 100)}%` }}
          />
        ))}
        {weights.slice(0, -1).map((w, i) => (
          <div
            key={`divider-${factors[i] ?? String(i)}`}
            role="slider"
            tabIndex={0}
            aria-label={`Weight between ${factors[i] ?? ''} and ${factors[i + 1] ?? ''}`}
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={Number((starts[i] ?? 0).toFixed(3))}
            aria-valuetext={`${factors[i] ?? ''} ${fmtWeight(w)}, ${factors[i + 1] ?? ''} ${fmtWeight(weights[i + 1] ?? 0)}`}
            onKeyDown={onKey(i)}
            onPointerDown={onPointerDown(i)}
            className="group absolute -top-1.5 -bottom-1.5 z-10 flex w-4 -translate-x-1/2 cursor-ew-resize justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
            style={{ left: `${String((starts[i] ?? 0) * 100)}%` }}
          >
            <span className="w-1 rounded-full bg-fg opacity-0 ring-2 ring-panel transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100" />
          </div>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-muted">
        {factors.map((f, i) => (
          <span key={f} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={`size-2 rounded-[2px] ${INK[i] ?? 'bg-raised'}`} />
            <span className="font-mono">{f}</span>
            <span className="font-mono text-fg tabular-nums">{fmtWeight(weights[i] ?? 0)}</span>
          </span>
        ))}
        <span className="ml-auto font-mono text-fg-subtle tabular-nums" data-testid={`sum-${code}`}>
          total {fmtWeight(weightSum(weights))}
        </span>
      </p>
    </div>
  )
}

interface SettingsProps {
  rule: RuleRow
  draft: Draft
  setDraft: (next: (d: Draft) => Draft) => void
  errors: Record<string, string>
}

function Settings({ rule, draft, setDraft, errors }: SettingsProps) {
  const fixed = Object.entries(rule.params).filter(([, v]) => paramKind(v) === 'fixed')
  return (
    <section aria-label={`${rule.code} settings`} className="flex min-w-0 flex-col gap-3">
      <h3 className="text-xs font-semibold text-fg-muted">Settings</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {editable(rule).map(([key, value]) => {
          const id = `param-${rule.code}-${key}`
          const unit = PARAM_META[key]?.unit
          const error = errors[key]
          return (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={id} className="text-[13px] font-medium text-fg">
                {paramLabel(key)}
                {unit && unit !== '×' && <span className="font-normal text-fg-subtle"> ({unit})</span>}
              </label>
              <input
                id={id}
                inputMode={paramKind(value) === 'time' ? 'text' : 'decimal'}
                value={draft.params[key] ?? ''}
                aria-invalid={Boolean(error)}
                aria-describedby={`${id}-hint`}
                onChange={(e) => {
                  const text = e.target.value
                  setDraft((d) => ({ ...d, params: { ...d.params, [key]: text } }))
                }}
                className="h-8 rounded-md border border-line-strong bg-panel px-2.5 font-mono text-[13px] text-fg tabular-nums transition-colors duration-150 hover:border-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none aria-invalid:border-danger"
              />
              <span id={`${id}-hint`} className={`text-xs ${error ? 'text-danger' : 'text-fg-subtle'}`}>
                {error ?? PARAM_META[key]?.hint ?? ''}
              </span>
            </div>
          )
        })}
      </div>
      {fixed.length > 0 && (
        <dl className="flex flex-col gap-2 border-t border-line pt-3">
          {fixed.map(([key, value]) => (
            <div key={key} className="grid gap-0.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3">
              <dt className="text-[13px] text-fg-subtle">{paramLabel(key)}</dt>
              <dd className="m-0 font-mono text-xs break-words text-fg-muted">{describeFixed(value)}</dd>
            </div>
          ))}
          <p className="text-xs text-fg-subtle">Lists like these change through the API (PUT /v1/rules/{rule.code}).</p>
        </dl>
      )}
    </section>
  )
}

type HistoryLoad = { status: 'loading' } | { status: 'ready'; versions: RuleVersion[] } | { status: 'error'; message: string }

const show = (v: unknown) => (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? String(v) : JSON.stringify(v))
const fieldName = (f: string) => f.replace(/^(params|weights)\./, '')

function History({ code, reloadKey }: { code: string; reloadKey: number }) {
  const [load, setLoad] = useState<HistoryLoad>({ status: 'loading' })
  const [now] = useState(() => Date.now())
  useEffect(() => {
    const controller = new AbortController()
    ruleHistory(code, controller.signal)
      .then((versions) => {
        setLoad({ status: 'ready', versions })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      controller.abort()
    }
  }, [code, reloadKey])

  return (
    <section aria-label={`${code} history`} className="flex min-w-0 flex-col gap-3">
      <h3 className="text-xs font-semibold text-fg-muted">History</h3>
      {load.status === 'loading' && <SkeletonRows rows={3} label="Loading history" />}
      {load.status === 'error' && <p className="text-[13px] text-fg-muted">History could not be read: {load.message}.</p>}
      {load.status === 'ready' && (
        <ol className="flex flex-col">
          {load.versions.map((v) => (
            <li key={v.version} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 border-t border-line py-2 first:border-t-0 first:pt-0">
              <span className="font-mono text-xs text-fg tabular-nums">v{v.version}</span>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-xs text-fg-muted">
                  {v.version === 0 ? 'Built-in default' : (v.updated_by_name ?? (v.updated_by ? v.updated_by : 'Seeded'))}
                  {v.updated_at && <span className="font-mono text-fg-subtle"> · {ago(now - new Date(v.updated_at).getTime())}</span>}
                </span>
                {v.changes.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {v.changes.map((c) => (
                      <li key={c.field} className="font-mono text-xs break-words text-fg-muted">
                        {fieldName(c.field)} <span className="text-fg-subtle line-through">{show(c.before)}</span> →{' '}
                        <span className="font-medium text-fg">{show(c.after)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {v.changes.length === 0 && v.version > 0 && <span className="text-xs text-fg-subtle">Same settings as the defaults</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
