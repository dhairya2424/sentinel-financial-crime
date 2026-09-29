import { LoaderCircle } from 'lucide-react'
import { useState, type ReactNode, type SubmitEvent } from 'react'
import { ApiError } from '@/api/client'
import { ingestEvents, newEventId, registerAccount, registerCustomer, registerEmployee, type AccountInput } from '@/api/entities'
import type { ActionType, Channel, EmployeeActionEvent, IngestEvent, LookupOption, TimelineEntity } from '@/api/types'
import { EntityPicker } from './EntityPicker'
import { FIELD, Field, MONO_FIELD, Pair, Segmented, type TabKey } from './fields'
import { entityLinks, useAddLog, type LogLink } from './log'
import { usePreview } from './preview'
import { formatInr } from '@/lib/timeline'
import { groupInr } from './money'
import { localNow, toIso } from './time'
import { TimelinePreview } from './TimelinePreview'

export interface FormProps {
  /** Called after anything is saved, so the rail counts refresh. */
  onSaved: () => void
  goTo: (tab: TabKey) => void
}

const REF = /^[A-Za-z0-9_\-/.]{2,64}$/
const MONEY = /^\d{1,16}(\.\d{1,2})?$/
const ROLE_SUGGESTIONS = ['teller', 'manager', 'finance_ops', 'analyst', 'admin_it']
const ENTITLEMENTS = ['tx.approve', 'beneficiary.add', 'limit.change', 'profile.edit', 'export.data', 'read.only', 'system.admin']

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
const clean = (s: string) => s.trim()
const opt = (s: string) => (s.trim() ? s.trim() : undefined)

// ---------------------------------------------------------------- shell

interface FormCardProps {
  title: string
  description: string
  submitLabel: string
  busy: boolean
  canSubmit: boolean
  error: string | null
  onSubmit: () => void
  onClear: () => void
  children: ReactNode
}

function FormCard({ title, description, submitLabel, busy, canSubmit, error, onSubmit, onClear, children }: FormCardProps) {
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (canSubmit && !busy) onSubmit()
  }
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4 rounded-card border border-line-strong bg-panel p-4 lg:p-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight text-fg">{title}</h2>
        <p className="text-[13px] text-fg-muted">{description}</p>
      </header>
      {children}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-10 items-center rounded-md border border-line-strong bg-panel px-3.5 text-[13px] font-medium text-fg transition-colors duration-150 hover:bg-raised"
        >
          Clear
        </button>
        <button
          type="submit"
          disabled={!canSubmit || busy}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-accent-fill px-4 text-sm font-semibold text-on-accent transition-colors duration-150 hover:bg-accent-fill-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
          {busy ? 'Saving' : submitLabel}
        </button>
      </div>
    </form>
  )
}

/** Shared save path for the registration forms: server errors show inline and in the log; success resets the form. */
function useRegister() {
  const add = useAddLog((s) => s.add)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (summary: string, save: () => Promise<{ summary: string; links: LogLink[]; id: string }>, done: () => void) => {
    setBusy(true)
    setError(null)
    try {
      const saved = await save()
      add({ state: 'saved', summary: saved.summary, links: saved.links, id: saved.id })
      done()
    } catch (err) {
      const reason = message(err)
      setError(reason)
      if (err instanceof ApiError) add({ state: 'rejected', summary, reason })
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

/** Shared save path for activity records: one event through the real ingest endpoint, with its outcome logged. */
function useRecord() {
  const add = useAddLog((s) => s.add)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (event: IngestEvent, summary: string, viewpoint: TimelineEntity | null, done: () => void) => {
    setBusy(true)
    setError(null)
    try {
      const res = await ingestEvents([event])
      const links = viewpoint ? entityLinks(viewpoint.type, viewpoint.id) : undefined
      if (res.accepted === 1) {
        add({ state: 'saved', summary, links })
        done()
      } else if (res.skipped_ids.includes(event.id)) {
        add({ state: 'skipped', summary, reason: 'this record was already saved' })
        done()
      } else {
        const reason = res.errors.find((e) => e.id === event.id)?.error ?? 'the server did not store it'
        setError(`Not saved: ${reason}.`)
        add({ state: 'rejected', summary, reason })
      }
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

// ---------------------------------------------------------------- register

export function CustomerForm({ onSaved }: FormProps) {
  const [name, setName] = useState('')
  const [ref, setRef] = useState('')
  const [kyc, setKyc] = useState<'' | 'verified' | 'pending' | 'rejected'>('')
  const [risk, setRisk] = useState<'' | 'low' | 'standard' | 'high'>('')
  const [segment, setSegment] = useState('')
  const { busy, error, setError, run } = useRegister()
  const refBad = ref !== '' && !REF.test(clean(ref))
  const reset = () => {
    setName('')
    setRef('')
    setKyc('')
    setRisk('')
    setSegment('')
    setError(null)
  }
  return (
    <FormCard
      title="Register a customer"
      description="A bank customer. Their accounts are registered next, under Account."
      submitLabel="Register customer"
      busy={busy}
      canSubmit={clean(name).length >= 2 && REF.test(clean(ref)) && kyc !== '' && risk !== ''}
      error={error}
      onClear={reset}
      onSubmit={() => {
        void run(
          `Customer ${clean(name)}`,
          async () => {
            if (!kyc || !risk) throw new Error('Choose the KYC status and risk rating.')
            const r = await registerCustomer({ name: clean(name), external_ref: clean(ref), kyc_status: kyc, risk_rating: risk, segment: opt(segment) })
            return { summary: `Customer ${r.label} · ${clean(ref)}`, links: entityLinks('customer', r.id), id: r.id }
          },
          () => {
            reset()
            onSaved()
          },
        )
      }}
    >
      <Pair>
        <Field id="cust-name" label="Full name">
          <input
            id="cust-name"
            className={FIELD}
            value={name}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value)
            }}
          />
        </Field>
        <Field id="cust-ref" label="Customer reference (CIF)" error={refBad ? 'Use letters, digits, - _ / or . (2 to 64 characters).' : null}>
          <input
            id="cust-ref"
            className={MONO_FIELD}
            value={ref}
            aria-invalid={refBad || undefined}
            autoComplete="off"
            onChange={(e) => {
              setRef(e.target.value)
            }}
          />
        </Field>
      </Pair>
      <Pair>
        <Field id="cust-kyc" label="KYC status">
          <select
            id="cust-kyc"
            className={FIELD}
            value={kyc}
            onChange={(e) => {
              setKyc(e.target.value as typeof kyc)
            }}
          >
            <option value="" disabled>
              Choose the KYC status
            </option>
            <option value="verified">Verified</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>
        </Field>
        <Field id="cust-risk" label="Risk rating">
          <select
            id="cust-risk"
            className={FIELD}
            value={risk}
            onChange={(e) => {
              setRisk(e.target.value as typeof risk)
            }}
          >
            <option value="" disabled>
              Choose the bank’s rating
            </option>
            <option value="standard">Standard</option>
            <option value="low">Low</option>
            <option value="high">High</option>
          </select>
        </Field>
      </Pair>
      <Field id="cust-seg" label="Segment" optional hint="For example salaried, business or senior.">
        <input
          id="cust-seg"
          className={FIELD}
          value={segment}
          onChange={(e) => {
            setSegment(e.target.value)
          }}
        />
      </Field>
    </FormCard>
  )
}

const ACCOUNT_TYPES: { value: AccountInput['type']; label: string }[] = [
  { value: 'savings', label: 'Savings' },
  { value: 'current', label: 'Current' },
  { value: 'salary', label: 'Salary' },
  { value: 'loan', label: 'Loan' },
  { value: 'fixed_deposit', label: 'Fixed deposit' },
]

export function AccountForm({ onSaved, goTo }: FormProps) {
  const [holder, setHolder] = useState<LookupOption | null>(null)
  const [number, setNumber] = useState('')
  const [type, setType] = useState<AccountInput['type']>('savings')
  const [opened, setOpened] = useState('')
  const { busy, error, setError, run } = useRegister()
  const digits = number.replace(/[\s-]/g, '')
  const numberBad = digits !== '' && !/^\d{6,20}$/.test(digits)
  const reset = () => {
    setNumber('')
    setOpened('')
    setError(null)
  }
  return (
    <FormCard
      title="Register an account"
      description="An account held by a registered customer. Transactions can only move between registered accounts or out to another bank."
      submitLabel="Register account"
      busy={busy}
      canSubmit={holder !== null && /^\d{6,20}$/.test(digits)}
      error={error}
      onClear={() => {
        reset()
        setHolder(null)
      }}
      onSubmit={() => {
        if (!holder) return
        void run(
          `Account ending ${digits.slice(-4)} for ${holder.label}`,
          async () => {
            const r = await registerAccount({
              customer_id: holder.id,
              account_number: digits,
              type,
              opened_at: opened ? new Date(`${opened}T00:00`).toISOString() : undefined,
            })
            return { summary: `Account ${r.label} for ${holder.label}`, links: entityLinks('account', r.id), id: r.id }
          },
          () => {
            reset()
            onSaved()
          },
        )
      }}
    >
      <Field id="acct-holder" label="Holder">
        <EntityPicker
          id="acct-holder"
          type="customer"
          value={holder}
          onChange={setHolder}
          placeholder="Search registered customers"
          onRegister={() => {
            goTo('customer')
          }}
        />
      </Field>
      <Pair>
        <Field
          id="acct-number"
          label="Account number"
          hint="Only a masked copy is stored: X for every digit but the last four."
          error={numberBad ? 'An account number has 6 to 20 digits.' : null}
        >
          <input
            id="acct-number"
            inputMode="numeric"
            autoComplete="off"
            className={MONO_FIELD}
            value={number}
            aria-invalid={numberBad || undefined}
            onChange={(e) => {
              setNumber(e.target.value)
            }}
          />
        </Field>
        <Field id="acct-type" label="Type">
          <select
            id="acct-type"
            className={FIELD}
            value={type}
            onChange={(e) => {
              setType(e.target.value as AccountInput['type'])
            }}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      </Pair>
      <Field id="acct-opened" label="Opened on" optional className="sm:max-w-[calc(50%-6px)]">
        <input
          id="acct-opened"
          type="date"
          className={FIELD}
          value={opened}
          onChange={(e) => {
            setOpened(e.target.value)
          }}
        />
      </Field>
    </FormCard>
  )
}

export function EmployeeForm({ onSaved }: FormProps) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [role, setRole] = useState('')
  const [dept, setDept] = useState('')
  const [manager, setManager] = useState<LookupOption | null>(null)
  const { busy, error, setError, run } = useRegister()
  const codeBad = code !== '' && !REF.test(clean(code))
  const reset = () => {
    setName('')
    setCode('')
    setRole('')
    setDept('')
    setManager(null)
    setError(null)
  }
  return (
    <FormCard
      title="Register an employee"
      description="A member of staff whose actions, sign-ins and access rights you will record."
      submitLabel="Register employee"
      busy={busy}
      canSubmit={clean(name).length >= 2 && REF.test(clean(code)) && clean(role).length >= 2}
      error={error}
      onClear={reset}
      onSubmit={() => {
        void run(
          `Employee ${clean(name)}`,
          async () => {
            const r = await registerEmployee({
              name: clean(name),
              external_ref: clean(code),
              role: clean(role),
              department: opt(dept),
              manager_id: manager?.id,
            })
            return { summary: `Employee ${r.label} · ${clean(role)}`, links: entityLinks('employee', r.id), id: r.id }
          },
          () => {
            reset()
            onSaved()
          },
        )
      }}
    >
      <Pair>
        <Field id="emp-name" label="Full name">
          <input
            id="emp-name"
            className={FIELD}
            value={name}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value)
            }}
          />
        </Field>
        <Field id="emp-code" label="Employee code" error={codeBad ? 'Use letters, digits, - _ / or . (2 to 64 characters).' : null}>
          <input
            id="emp-code"
            className={MONO_FIELD}
            value={code}
            aria-invalid={codeBad || undefined}
            autoComplete="off"
            onChange={(e) => {
              setCode(e.target.value)
            }}
          />
        </Field>
      </Pair>
      <Pair>
        <Field id="emp-role" label="Role" hint="Detection checks actions against the role, so use the bank's role name.">
          <input
            id="emp-role"
            list="emp-roles"
            className={FIELD}
            value={role}
            autoComplete="off"
            onChange={(e) => {
              setRole(e.target.value)
            }}
          />
          <datalist id="emp-roles">
            {ROLE_SUGGESTIONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>
        <Field id="emp-dept" label="Department" optional>
          <input
            id="emp-dept"
            className={FIELD}
            value={dept}
            onChange={(e) => {
              setDept(e.target.value)
            }}
          />
        </Field>
      </Pair>
      <Field id="emp-manager" label="Reports to" optional>
        <EntityPicker id="emp-manager" type="employee" value={manager} onChange={setManager} placeholder="Search registered employees" />
      </Field>
    </FormCard>
  )
}

// ---------------------------------------------------------------- record activity

type Flow = 'between' | 'out' | 'in'

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'upi', label: 'UPI' },
  { value: 'neft', label: 'NEFT' },
  { value: 'rtgs', label: 'RTGS' },
  { value: 'atm', label: 'ATM' },
  { value: 'pos', label: 'POS' },
]

function WhenField({
  id,
  label,
  value,
  onChange,
  optional = false,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  optional?: boolean
}) {
  const bad = value !== '' && toIso(value) === null
  return (
    <Field id={id} label={label} optional={optional} error={bad ? 'Enter a date and time.' : null}>
      <input
        id={id}
        type="datetime-local"
        className={MONO_FIELD}
        value={value}
        aria-invalid={bad || undefined}
        onChange={(e) => {
          onChange(e.target.value)
        }}
      />
    </Field>
  )
}

export function TransactionForm({ onSaved, goTo }: FormProps) {
  const [id, setId] = useState(() => newEventId('transaction'))
  const [flow, setFlow] = useState<Flow>('between')
  const [from, setFrom] = useState<LookupOption | null>(null)
  const [to, setTo] = useState<LookupOption | null>(null)
  const [amount, setAmount] = useState('')
  const [channel, setChannel] = useState<Channel>('neft')
  const [when, setWhen] = useState(localNow)
  const [status, setStatus] = useState<'completed' | 'pending' | 'failed'>('completed')
  const [narration, setNarration] = useState('')
  const [counterparty, setCounterparty] = useState('')
  const [reference, setReference] = useState('')
  const { busy, error, run } = useRecord()

  const needFrom = flow !== 'in'
  const needTo = flow !== 'out'
  const amt = amount.replace(/[,\s₹]/g, '')
  const missing = [
    ...(needFrom && !from ? ['the sending account'] : []),
    ...(needTo && !to ? ['the receiving account'] : []),
    ...(!MONEY.test(amt) || Number(amt) <= 0 ? ['the amount'] : []),
    ...(toIso(when) ? [] : ['when it happened']),
  ]
  const same = needFrom && needTo && from !== null && from.id === to?.id
  const raw = {
    ...(opt(narration) ? { narration: clean(narration) } : {}),
    ...(flow !== 'between' && opt(counterparty) ? { counterparty: clean(counterparty) } : {}),
  }
  const event: IngestEvent | null =
    missing.length || same
      ? null
      : {
          kind: 'transaction',
          id,
          from_account_id: needFrom ? from?.id : undefined,
          to_account_id: needTo ? to?.id : undefined,
          amount: amt,
          channel,
          status,
          reference_no: opt(reference),
          value_ts: toIso(when) ?? '',
          ...(Object.keys(raw).length ? { raw } : {}),
        }
  const preview = usePreview(event)
  const problem = preview.status === 'ready' ? preview.preview.problem : null
  const viewpoint = preview.status === 'ready' ? preview.preview.viewpoint : null
  const other = flow === 'between' ? to?.label : clean(counterparty) || 'another bank'
  const summary = `${channel.toUpperCase()} ${event ? formatInr(amt) : ''} ${flow === 'in' ? `from ${other} to ${to?.label ?? ''}` : `from ${from?.label ?? ''} to ${other ?? ''}`}`

  return (
    <FormCard
      title="Record a transaction"
      description="Money moving between registered accounts, or between one of them and another bank."
      submitLabel="Record transaction"
      busy={busy}
      canSubmit={event !== null && !problem && preview.status !== 'loading'}
      error={error ?? (same ? 'The sending and receiving accounts must be different.' : null)}
      onClear={() => {
        setFrom(null)
        setTo(null)
        setAmount('')
        setNarration('')
        setCounterparty('')
        setReference('')
        setWhen(localNow())
      }}
      onSubmit={() => {
        if (!event) return
        void run(event, summary, viewpoint, () => {
          setId(newEventId('transaction'))
          setAmount('')
          setNarration('')
          setReference('')
          setWhen(localNow())
          onSaved()
        })
      }}
    >
      <Segmented
        id="tx-flow"
        label="Between"
        value={flow}
        onChange={setFlow}
        options={[
          { value: 'between', label: 'Registered accounts' },
          { value: 'out', label: 'To another bank' },
          { value: 'in', label: 'From another bank' },
        ]}
      />
      <Pair>
        {needFrom ? (
          <Field id="tx-from" label="From account">
            <EntityPicker
              id="tx-from"
              type="account"
              value={from}
              onChange={setFrom}
              placeholder="Masked number or holder name"
              onRegister={() => {
                goTo('account')
              }}
            />
          </Field>
        ) : (
          <Field id="tx-cp" label="Sender at the other bank" optional>
            <input
              id="tx-cp"
              className={FIELD}
              value={counterparty}
              onChange={(e) => {
                setCounterparty(e.target.value)
              }}
            />
          </Field>
        )}
        {needTo ? (
          <Field id="tx-to" label="To account">
            <EntityPicker
              id="tx-to"
              type="account"
              value={to}
              onChange={setTo}
              placeholder="Masked number or holder name"
              onRegister={() => {
                goTo('account')
              }}
            />
          </Field>
        ) : (
          <Field id="tx-cp" label="Payee at the other bank" optional>
            <input
              id="tx-cp"
              className={FIELD}
              value={counterparty}
              onChange={(e) => {
                setCounterparty(e.target.value)
              }}
            />
          </Field>
        )}
      </Pair>
      <Pair>
        <Field id="tx-amount" label="Amount (₹)">
          <input
            id="tx-amount"
            inputMode="decimal"
            autoComplete="off"
            className={MONO_FIELD}
            value={amount}
            onChange={(e) => {
              setAmount(groupInr(e.target.value))
            }}
          />
        </Field>
        <WhenField id="tx-when" label="Value date and time" value={when} onChange={setWhen} />
      </Pair>
      <Pair>
        <Segmented id="tx-channel" label="Channel" value={channel} onChange={setChannel} options={CHANNELS} />
        <Field id="tx-status" label="Status" hint={status === 'completed' ? undefined : 'Only completed transfers are drawn on the Graph.'}>
          <select
            id="tx-status"
            className={FIELD}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status)
            }}
          >
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        </Field>
      </Pair>
      <Pair>
        <Field id="tx-narration" label="Bank narration" optional hint="The statement text, such as UPI SWIGGY.">
          <input
            id="tx-narration"
            className={MONO_FIELD}
            value={narration}
            onChange={(e) => {
              setNarration(e.target.value)
            }}
          />
        </Field>
        <Field id="tx-ref" label="Reference number" optional>
          <input
            id="tx-ref"
            className={MONO_FIELD}
            value={reference}
            onChange={(e) => {
              setReference(e.target.value)
            }}
          />
        </Field>
      </Pair>
      <TimelinePreview state={preview} missing={missing} />
    </FormCard>
  )
}

const ACTIONS: { value: ActionType; label: string }[] = [
  { value: 'profile.edit', label: 'Edited a customer profile' },
  { value: 'beneficiary.add', label: 'Added a beneficiary' },
  { value: 'limit.change', label: 'Changed a transfer limit' },
  { value: 'tx.approve', label: 'Approved a transaction' },
  { value: 'export.data', label: 'Exported data' },
  { value: 'login', label: 'Logged in' },
  { value: 'logout', label: 'Logged out' },
]

const PROFILE_FIELDS = [
  { value: 'mobile', label: 'Mobile number' },
  { value: 'email', label: 'Email' },
  { value: 'address', label: 'Address' },
  { value: 'nominee', label: 'Nominee' },
  { value: 'kyc_document', label: 'KYC document' },
]

export function ActionForm({ onSaved, goTo }: FormProps) {
  const [id, setId] = useState(() => newEventId('employee_action'))
  const [employee, setEmployee] = useState<LookupOption | null>(null)
  const [action, setAction] = useState<ActionType>('profile.edit')
  const [target, setTarget] = useState<LookupOption | null>(null)
  const [session, setSession] = useState<LookupOption | null>(null)
  const [field, setField] = useState('mobile')
  const [oldValue, setOldValue] = useState('')
  const [newValue, setNewValue] = useState('')
  const [payee, setPayee] = useState('')
  const [payeeAccount, setPayeeAccount] = useState('')
  const [when, setWhen] = useState(localNow)
  const [ip, setIp] = useState('')
  const { busy, error, run } = useRecord()

  const targetType =
    action === 'profile.edit'
      ? 'customer'
      : action === 'tx.approve'
        ? 'transaction'
        : action === 'beneficiary.add' || action === 'limit.change'
          ? 'account'
          : 'system'
  const limitOld = oldValue.replace(/[,\s₹]/g, '')
  const limitNew = newValue.replace(/[,\s₹]/g, '')
  const change: Pick<EmployeeActionEvent, 'before_state' | 'after_state'> | null =
    action === 'profile.edit'
      ? clean(newValue)
        ? { after_state: { [field]: clean(newValue) }, ...(clean(oldValue) ? { before_state: { [field]: clean(oldValue) } } : {}) }
        : null
      : action === 'limit.change'
        ? MONEY.test(limitNew)
          ? {
              after_state: { daily_transfer_limit: Number(limitNew) },
              ...(MONEY.test(limitOld) ? { before_state: { daily_transfer_limit: Number(limitOld) } } : {}),
            }
          : null
        : action === 'beneficiary.add'
          ? clean(payee)
            ? { after_state: { added: { name: clean(payee), ...(clean(payeeAccount) ? { account: clean(payeeAccount) } : {}) } } }
            : null
          : {}
  const missing = [
    ...(employee ? [] : ['the employee']),
    ...(targetType !== 'system' && !target ? [`the ${targetType}`] : []),
    ...(change ? [] : [action === 'profile.edit' ? 'the new value' : action === 'limit.change' ? 'the new limit' : 'the beneficiary name']),
    ...(toIso(when) ? [] : ['when it happened']),
  ]
  const event: IngestEvent | null =
    missing.length || !employee || !change
      ? null
      : {
          kind: 'employee_action',
          id,
          employee_id: employee.id,
          session_id: session?.id,
          action_type: action,
          target_type: targetType,
          target_id: targetType === 'system' ? 'system' : (target?.id ?? ''),
          ip_address: opt(ip),
          event_ts: toIso(when) ?? '',
          ...change,
        }
  const preview = usePreview(event)
  const problem = preview.status === 'ready' ? preview.preview.problem : null
  const viewpoint = preview.status === 'ready' ? preview.preview.viewpoint : null
  const title = preview.status === 'ready' ? preview.preview.item?.title : null
  const summary = `${employee?.label ?? 'Employee'}: ${title ?? ACTIONS.find((a) => a.value === action)?.label ?? action}${target && targetType !== 'system' ? ` · ${target.label}` : ''}`
  const pickTarget = (value: ActionType) => {
    setAction(value)
    setTarget(null)
    setOldValue('')
    setNewValue('')
  }

  return (
    <FormCard
      title="Record an employee action"
      description="Something a member of staff did in the bank's systems: a profile edit, a new beneficiary, a limit change, an approval, an export or a sign-in."
      submitLabel="Record action"
      busy={busy}
      canSubmit={event !== null && !problem && preview.status !== 'loading'}
      error={error}
      onClear={() => {
        setTarget(null)
        setSession(null)
        setOldValue('')
        setNewValue('')
        setPayee('')
        setPayeeAccount('')
        setIp('')
        setWhen(localNow())
      }}
      onSubmit={() => {
        if (!event) return
        void run(event, summary, viewpoint, () => {
          setId(newEventId('employee_action'))
          setOldValue('')
          setNewValue('')
          setPayee('')
          setPayeeAccount('')
          setWhen(localNow())
          onSaved()
        })
      }}
    >
      <Pair>
        <Field id="act-emp" label="Employee">
          <EntityPicker
            id="act-emp"
            type="employee"
            value={employee}
            onChange={(v) => {
              setEmployee(v)
              setSession(null)
            }}
            placeholder="Search registered employees"
            onRegister={() => {
              goTo('employee')
            }}
          />
        </Field>
        <Field id="act-type" label="Action">
          <select
            id="act-type"
            className={FIELD}
            value={action}
            onChange={(e) => {
              pickTarget(e.target.value as ActionType)
            }}
          >
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
      </Pair>
      {targetType !== 'system' && (
        <Field id="act-target" label={targetType === 'customer' ? 'Customer' : targetType === 'transaction' ? 'Transaction approved' : 'Account'}>
          <EntityPicker
            key={targetType}
            id="act-target"
            type={targetType}
            value={target}
            onChange={setTarget}
            placeholder={
              targetType === 'transaction'
                ? 'Masked account number, or pick a recent transaction'
                : targetType === 'account'
                  ? 'Masked number or holder name'
                  : 'Search registered customers'
            }
            onRegister={
              targetType === 'transaction'
                ? () => {
                    goTo('tx')
                  }
                : () => {
                    goTo(targetType)
                  }
            }
          />
        </Field>
      )}
      {action === 'profile.edit' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="act-field" label="Field changed">
            <select
              id="act-field"
              className={FIELD}
              value={field}
              onChange={(e) => {
                setField(e.target.value)
              }}
            >
              {PROFILE_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="act-old" label="Old value" optional>
            <input
              id="act-old"
              className={FIELD}
              value={oldValue}
              onChange={(e) => {
                setOldValue(e.target.value)
              }}
            />
          </Field>
          <Field id="act-new" label="New value">
            <input
              id="act-new"
              className={FIELD}
              value={newValue}
              onChange={(e) => {
                setNewValue(e.target.value)
              }}
            />
          </Field>
        </div>
      )}
      {action === 'limit.change' && (
        <Pair>
          <Field id="act-old" label="Old daily limit (₹)" optional>
            <input
              id="act-old"
              inputMode="decimal"
              className={MONO_FIELD}
              value={oldValue}
              onChange={(e) => {
                setOldValue(groupInr(e.target.value))
              }}
            />
          </Field>
          <Field id="act-new" label="New daily limit (₹)">
            <input
              id="act-new"
              inputMode="decimal"
              className={MONO_FIELD}
              value={newValue}
              onChange={(e) => {
                setNewValue(groupInr(e.target.value))
              }}
            />
          </Field>
        </Pair>
      )}
      {action === 'beneficiary.add' && (
        <Pair>
          <Field id="act-payee" label="Beneficiary name">
            <input
              id="act-payee"
              className={FIELD}
              value={payee}
              onChange={(e) => {
                setPayee(e.target.value)
              }}
            />
          </Field>
          <Field id="act-payee-acct" label="Beneficiary account" optional hint="As shown to staff, for example the masked number.">
            <input
              id="act-payee-acct"
              className={MONO_FIELD}
              value={payeeAccount}
              onChange={(e) => {
                setPayeeAccount(e.target.value)
              }}
            />
          </Field>
        </Pair>
      )}
      <Pair>
        <WhenField id="act-when" label="When" value={when} onChange={setWhen} />
        <Field id="act-session" label="During session" optional>
          <EntityPicker
            key={employee?.id ?? 'none'}
            id="act-session"
            type="session"
            employeeId={employee?.id}
            value={session}
            onChange={setSession}
            disabled={!employee}
            placeholder={employee ? 'Pick one of their sessions' : 'Choose the employee first'}
            onRegister={() => {
              goTo('session')
            }}
          />
        </Field>
      </Pair>
      <Field id="act-ip" label="IP address" optional className="sm:max-w-[calc(50%-6px)]">
        <input
          id="act-ip"
          className={MONO_FIELD}
          value={ip}
          onChange={(e) => {
            setIp(e.target.value)
          }}
        />
      </Field>
      <TimelinePreview state={preview} missing={missing} />
    </FormCard>
  )
}

export function SessionForm({ onSaved, goTo }: FormProps) {
  const [id, setId] = useState(() => newEventId('session'))
  const [employee, setEmployee] = useState<LookupOption | null>(null)
  const [outcome, setOutcome] = useState<'success' | 'fail' | 'lockout'>('success')
  const [started, setStarted] = useState(localNow)
  const [ended, setEnded] = useState('')
  const [ip, setIp] = useState('')
  const [device, setDevice] = useState('')
  const { busy, error, run } = useRecord()
  const endBad = ended !== '' && (toIso(ended) === null || (toIso(started) ?? '') > (toIso(ended) ?? ''))
  const missing = [...(employee ? [] : ['the employee']), ...(toIso(started) ? [] : ['when it started'])]
  const event: IngestEvent | null =
    missing.length || !employee || endBad
      ? null
      : {
          kind: 'session',
          id,
          employee_id: employee.id,
          outcome,
          started_at: toIso(started) ?? '',
          ended_at: toIso(ended) ?? undefined,
          ip_address: opt(ip),
          device: opt(device),
        }
  const preview = usePreview(event)
  const problem = preview.status === 'ready' ? preview.preview.problem : null
  const viewpoint = preview.status === 'ready' ? preview.preview.viewpoint : null
  const label = { success: 'Signed in', fail: 'Failed sign-in', lockout: 'Locked out' }[outcome]
  return (
    <FormCard
      title="Record a session"
      description="An employee signing in to the bank's systems, or failing to. Actions can then be tied to the session."
      submitLabel="Record session"
      busy={busy}
      canSubmit={event !== null && !problem && preview.status !== 'loading'}
      error={error}
      onClear={() => {
        setEnded('')
        setIp('')
        setDevice('')
        setStarted(localNow())
      }}
      onSubmit={() => {
        if (!event) return
        void run(event, `${employee?.label ?? 'Employee'}: ${label}${opt(ip) ? ` from ${clean(ip)}` : ''}`, viewpoint, () => {
          setId(newEventId('session'))
          setEnded('')
          setStarted(localNow())
          onSaved()
        })
      }}
    >
      <Pair>
        <Field id="sess-emp" label="Employee">
          <EntityPicker
            id="sess-emp"
            type="employee"
            value={employee}
            onChange={setEmployee}
            placeholder="Search registered employees"
            onRegister={() => {
              goTo('employee')
            }}
          />
        </Field>
        <Segmented
          id="sess-outcome"
          label="Outcome"
          value={outcome}
          onChange={setOutcome}
          options={[
            { value: 'success', label: 'Signed in' },
            { value: 'fail', label: 'Failed' },
            { value: 'lockout', label: 'Locked out' },
          ]}
        />
      </Pair>
      <Pair>
        <WhenField id="sess-start" label="Started" value={started} onChange={setStarted} />
        <Field id="sess-end" label="Ended" optional error={endBad ? 'The end must be a date and time after the start.' : null}>
          <input
            id="sess-end"
            type="datetime-local"
            className={MONO_FIELD}
            value={ended}
            aria-invalid={endBad || undefined}
            onChange={(e) => {
              setEnded(e.target.value)
            }}
          />
        </Field>
      </Pair>
      <Pair>
        <Field id="sess-ip" label="IP address" optional>
          <input
            id="sess-ip"
            className={MONO_FIELD}
            value={ip}
            onChange={(e) => {
              setIp(e.target.value)
            }}
          />
        </Field>
        <Field id="sess-device" label="Device" optional>
          <input
            id="sess-device"
            className={FIELD}
            value={device}
            onChange={(e) => {
              setDevice(e.target.value)
            }}
          />
        </Field>
      </Pair>
      <TimelinePreview state={preview} missing={missing} />
    </FormCard>
  )
}

type Scope = 'all' | 'account' | 'customer'

export function AccessRightForm({ onSaved, goTo }: FormProps) {
  const [id, setId] = useState(() => newEventId('access_right'))
  const [employee, setEmployee] = useState<LookupOption | null>(null)
  const [entitlement, setEntitlement] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [scopeTarget, setScopeTarget] = useState<LookupOption | null>(null)
  const [granted, setGranted] = useState(localNow)
  const [grantedBy, setGrantedBy] = useState('')
  const { busy, error, run } = useRecord()
  const ent = clean(entitlement)
  const missing = [
    ...(employee ? [] : ['the employee']),
    ...(ent.length >= 2 ? [] : ['the entitlement']),
    ...(scope !== 'all' && !scopeTarget ? [`the ${scope}`] : []),
    ...(toIso(granted) ? [] : ['when it was granted']),
  ]
  const event: IngestEvent | null =
    missing.length || !employee
      ? null
      : {
          kind: 'access_right',
          id,
          employee_id: employee.id,
          entitlement: ent,
          scope: scope === 'all' ? '*' : scopeTarget?.id,
          granted_at: toIso(granted) ?? '',
          granted_by: opt(grantedBy),
        }
  const preview = usePreview(event)
  const problem = preview.status === 'ready' ? preview.preview.problem : null
  const viewpoint = preview.status === 'ready' ? preview.preview.viewpoint : null
  return (
    <FormCard
      title="Grant an access right"
      description="An entitlement an employee holds, such as tx.approve. Detection compares every action with the rights held at the time."
      submitLabel="Grant access right"
      busy={busy}
      canSubmit={event !== null && !problem && preview.status !== 'loading'}
      error={error}
      onClear={() => {
        setEntitlement('')
        setScope('all')
        setScopeTarget(null)
        setGrantedBy('')
        setGranted(localNow())
      }}
      onSubmit={() => {
        if (!event) return
        void run(event, `${employee?.label ?? 'Employee'}: granted ${ent}${scopeTarget ? ` on ${scopeTarget.label}` : ''}`, viewpoint, () => {
          setId(newEventId('access_right'))
          setEntitlement('')
          setGranted(localNow())
          onSaved()
        })
      }}
    >
      <Pair>
        <Field id="ar-emp" label="Employee">
          <EntityPicker
            id="ar-emp"
            type="employee"
            value={employee}
            onChange={setEmployee}
            placeholder="Search registered employees"
            onRegister={() => {
              goTo('employee')
            }}
          />
        </Field>
        <Field id="ar-ent" label="Entitlement" hint="The action it allows, for example tx.approve or limit.change.">
          <input
            id="ar-ent"
            list="ar-ents"
            className={MONO_FIELD}
            value={entitlement}
            autoComplete="off"
            onChange={(e) => {
              setEntitlement(e.target.value)
            }}
          />
          <datalist id="ar-ents">
            {ENTITLEMENTS.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </Field>
      </Pair>
      <Segmented
        id="ar-scope"
        label="Covers"
        value={scope}
        onChange={(v) => {
          setScope(v)
          setScopeTarget(null)
        }}
        options={[
          { value: 'all', label: 'All customers' },
          { value: 'customer', label: 'One customer' },
          { value: 'account', label: 'One account' },
        ]}
      />
      {scope !== 'all' && (
        <Field id="ar-target" label={scope === 'account' ? 'Account' : 'Customer'}>
          <EntityPicker
            key={scope}
            id="ar-target"
            type={scope}
            value={scopeTarget}
            onChange={setScopeTarget}
            placeholder={scope === 'account' ? 'Masked number or holder name' : 'Search registered customers'}
            onRegister={() => {
              goTo(scope)
            }}
          />
        </Field>
      )}
      <Pair>
        <WhenField id="ar-when" label="Granted" value={granted} onChange={setGranted} />
        <Field id="ar-by" label="Granted by" optional>
          <input
            id="ar-by"
            className={FIELD}
            value={grantedBy}
            onChange={(e) => {
              setGrantedBy(e.target.value)
            }}
          />
        </Field>
      </Pair>
      <TimelinePreview state={preview} missing={missing} />
    </FormCard>
  )
}
