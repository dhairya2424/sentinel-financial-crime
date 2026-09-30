import { LoaderCircle } from 'lucide-react'
import { useId, useState } from 'react'
import type { CaseStatus } from '@/api/types'
import { Dialog } from '@/components/Dialog'

export const CLOSE_NOTE_MIN = 10

type Verdict = 'closed_confirmed' | 'closed_false_positive'

interface CloseCaseDialogProps {
  caseNumber: string
  initial: Verdict
  onClose: () => void
  /** Resolves when the case is closed; rejects with the server's reason, which the dialog shows. */
  onSubmit: (status: CaseStatus, note: string) => Promise<void>
}

/** Closing a case (docs/04 §6): a verdict and a disposition note of at least 10 characters, checked here and by the server. */
export function CloseCaseDialog({ caseNumber, initial, onClose, onSubmit }: CloseCaseDialogProps) {
  const [verdict, setVerdict] = useState<Verdict>(initial)
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const noteId = useId()
  const hintId = useId()
  const length = note.trim().length
  const short = length < CLOSE_NOTE_MIN

  const submit = () => {
    setTouched(true)
    if (short) return
    setBusy(true)
    setError(null)
    onSubmit(verdict, note.trim())
      .then(onClose)
      .catch((err: unknown) => {
        setBusy(false)
        setError(err instanceof Error ? err.message : String(err))
      })
  }

  return (
    <Dialog title={`Close ${caseNumber}`} description="Closing is final. The verdict is copied to every linked alert." onClose={onClose} busy={busy}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex flex-col gap-4"
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium text-fg">Verdict</legend>
          {(
            [
              ['closed_confirmed', 'Confirmed', 'The activity is what the alerts say it is.'],
              ['closed_false_positive', 'False positive', 'The activity has a legitimate explanation.'],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 ${verdict === value ? 'border-line-strong bg-selected' : 'border-line hover:bg-raised'}`}
            >
              <input
                type="radio"
                name="verdict"
                value={value}
                checked={verdict === value}
                onChange={() => {
                  setVerdict(value)
                }}
                className="mt-1 accent-accent"
              />
              <span className="flex flex-col">
                <span className="text-[13px] font-medium text-fg">{label}</span>
                <span className="text-xs text-fg-muted">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={noteId} className="text-[13px] font-medium text-fg">
            Disposition note
          </label>
          <textarea
            id={noteId}
            data-autofocus
            rows={4}
            value={note}
            maxLength={5000}
            aria-invalid={touched && short}
            aria-describedby={hintId}
            onChange={(e) => {
              setNote(e.target.value)
            }}
            placeholder="What you found and why this verdict. It goes into the case notes and the evidence bundle."
            className="resize-y rounded-md border border-line-strong bg-panel px-3 py-2 text-[13px] text-fg placeholder:text-fg-subtle aria-invalid:border-danger"
          />
          <p id={hintId} className={`flex justify-between text-xs ${touched && short ? 'text-danger' : 'text-fg-subtle'}`}>
            <span>{touched && short ? `Write at least ${String(CLOSE_NOTE_MIN)} characters.` : `At least ${String(CLOSE_NOTE_MIN)} characters.`}</span>
            <span className="font-mono">{length}</span>
          </p>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            Not closed: {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-md border border-line-strong bg-panel px-3 text-[13px] font-medium text-fg hover:bg-raised disabled:opacity-55"
          >
            Keep open
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent-fill px-3 text-[13px] font-semibold text-on-accent hover:bg-accent-fill-hover disabled:opacity-55"
          >
            {busy && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />}
            Close as {verdict === 'closed_confirmed' ? 'confirmed' : 'false positive'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
