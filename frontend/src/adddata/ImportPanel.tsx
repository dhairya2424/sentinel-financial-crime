import { FileUp, LoaderCircle } from 'lucide-react'
import { useId, useState, type DragEvent } from 'react'
import { ApiError } from '@/api/client'
import { ingestEvents } from '@/api/entities'
import type { IngestEvent } from '@/api/types'
import { useAddLog } from './log'
import { BATCH, COLUMNS, ImportFileError, parseImport, type ParsedRow } from './importFile'

type Outcome = { state: 'saved' | 'skipped' | 'rejected'; reason?: string }

interface ImportPanelProps {
  onSaved: () => void
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function send(events: IngestEvent[]): Promise<Map<string, Outcome>> {
  const out = new Map<string, Outcome>()
  const apply = (batch: IngestEvent[], res: Awaited<ReturnType<typeof ingestEvents>>) => {
    const errors = new Map(res.errors.map((e) => [e.id, e.error]))
    const skipped = new Set(res.skipped_ids)
    for (const e of batch) {
      out.set(e.id, errors.has(e.id) ? { state: 'rejected', reason: errors.get(e.id) } : skipped.has(e.id) ? { state: 'skipped' } : { state: 'saved' })
    }
  }
  for (let i = 0; i < events.length; i += BATCH) {
    const batch = events.slice(i, i + BATCH)
    try {
      apply(batch, await ingestEvents(batch))
    } catch (err) {
      // A malformed row fails the whole batch's schema check (422); send that batch one row at a time to find it.
      if (!(err instanceof ApiError) || err.status !== 422) throw err
      for (const e of batch) {
        try {
          apply([e], await ingestEvents([e]))
        } catch (rowErr) {
          out.set(e.id, { state: 'rejected', reason: message(rowErr) })
        }
      }
    }
  }
  return out
}

export function ImportPanel({ onSaved }: ImportPanelProps) {
  const inputId = useId()
  const add = useAddLog((s) => s.add)
  const [file, setFile] = useState<string | null>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Map<string, Outcome> | null>(null)

  const ready = rows.filter((r) => r.event !== null)
  const read = async (f: File) => {
    setResults(null)
    setFileError(null)
    setFile(f.name)
    try {
      setRows(parseImport(f.name, await f.text()))
    } catch (err) {
      setRows([])
      setFileError(err instanceof ImportFileError ? err.message : `The file could not be read: ${message(err)}`)
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) void read(f)
  }
  const run = async () => {
    setBusy(true)
    setFileError(null)
    try {
      const out = await send(ready.map((r) => r.event as IngestEvent))
      setResults(out)
      const n = { saved: 0, skipped: 0, rejected: 0 }
      out.forEach((o) => {
        n[o.state] += 1
      })
      const invalid = rows.length - ready.length
      add({
        state: n.saved === 0 ? 'rejected' : n.rejected + invalid > 0 ? 'partial' : 'saved',
        summary: `Imported ${file ?? 'file'}: ${String(n.saved)} saved${n.skipped ? `, ${String(n.skipped)} already present` : ''}${n.rejected + invalid ? `, ${String(n.rejected + invalid)} rejected` : ''}`,
        reason: n.rejected + invalid > 0 ? 'The results table lists the reason for each rejected row.' : undefined,
      })
      onSaved()
    } catch (err) {
      setFileError(`The import stopped: ${message(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const outcomeOf = (r: ParsedRow): Outcome | null =>
    r.error ? { state: 'rejected', reason: r.error } : r.event && results ? (results.get(r.event.id) ?? null) : null

  return (
    <div className="flex flex-col gap-4 rounded-card border border-line-strong bg-panel p-4 lg:p-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight text-fg">Import a file</h2>
        <p className="text-[13px] text-fg-muted">
          A CSV or JSON export of transactions, employee actions, sessions or access rights. Every row goes through the same checks as the forms, and nothing is
          sent until you press Import.
        </p>
      </header>

      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => {
          setDragging(false)
        }}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-card border border-dashed px-4 py-6 text-center transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
          dragging ? 'border-accent bg-selected' : 'border-line-strong hover:bg-raised/60'
        }`}
      >
        <FileUp aria-hidden="true" className="size-5 text-fg-muted" />
        <span className="text-[13px] font-medium text-fg">{file ? `Choose another file, or drop it here` : 'Choose a file, or drop it here'}</span>
        <span className="text-xs text-fg-subtle">.csv or .json · up to 5,000 records</span>
        <input
          id={inputId}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void read(f)
            e.target.value = ''
          }}
        />
      </label>

      {fileError && (
        <p role="alert" className="text-[13px] text-danger">
          {fileError}
        </p>
      )}

      {rows.length > 0 && (
        <section aria-label={`Records in ${file ?? 'the file'}`} className="flex flex-col gap-2">
          <p className="text-[13px] text-fg-muted">
            <span className="font-mono text-fg">{rows.length}</span> {rows.length === 1 ? 'record' : 'records'} in{' '}
            <span className="font-medium text-fg">{file}</span>
            {rows.length - ready.length > 0 && (
              <>
                {' · '}
                <span className="text-danger">
                  {rows.length - ready.length} {rows.length - ready.length === 1 ? 'needs' : 'need'} fixing in the file
                </span>
              </>
            )}
          </p>
          <div className="max-h-72 overflow-auto rounded-card border border-line">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead className="sticky top-0 bg-raised text-xs text-fg-muted">
                <tr>
                  <th scope="col" className="w-12 px-3 py-1.5 font-medium">
                    Row
                  </th>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Record
                  </th>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const o = outcomeOf(r)
                  return (
                    <tr key={r.row} className="border-t border-line align-top">
                      <td className="px-3 py-1.5 font-mono text-xs text-fg-subtle tabular-nums">{r.row}</td>
                      <td className="px-3 py-1.5 text-[13px] [overflow-wrap:anywhere] text-fg">{r.summary}</td>
                      <td className="px-3 py-1.5 text-xs">
                        {!o ? (
                          <span className="text-fg-subtle">Ready</span>
                        ) : o.state === 'saved' ? (
                          <span className="font-mono text-ok">saved</span>
                        ) : o.state === 'skipped' ? (
                          <span className="text-fg-muted">Already saved earlier</span>
                        ) : (
                          <span className="text-danger">{o.reason}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
            {results ? (
              <p className="text-[13px] text-fg-muted">Import finished. Choose another file above to import more.</p>
            ) : (
              <button
                type="button"
                disabled={busy || ready.length === 0}
                onClick={() => {
                  void run()
                }}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-accent-fill px-4 text-sm font-semibold text-on-accent transition-colors duration-150 hover:bg-accent-fill-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
                {busy ? 'Importing' : `Import ${String(ready.length)} ${ready.length === 1 ? 'record' : 'records'}`}
              </button>
            )}
          </div>
        </section>
      )}

      <details className="group rounded-card border border-line px-3.5 py-2.5 text-[13px]">
        <summary className="cursor-pointer font-medium text-fg marker:text-fg-subtle">What the file should contain</summary>
        <div className="mt-2 flex flex-col gap-2 text-fg-muted">
          <p>
            One record per row (CSV, with a header) or per item (JSON list). The <code className="font-mono text-xs text-fg">kind</code> column says what each
            record is. Refer to customers, accounts and employees by their Sentinel id, which the log on this page shows after you register them. Times are ISO
            8601 with a timezone, for example <code className="font-mono text-xs text-fg">2026-09-28T10:30:00+05:30</code>. The id column is optional; a row
            without one gets a new id. In CSV, <code className="font-mono text-xs text-fg">before_state</code>,{' '}
            <code className="font-mono text-xs text-fg">after_state</code> and <code className="font-mono text-xs text-fg">raw</code> hold JSON.
          </p>
          <dl className="grid gap-1.5">
            {Object.entries(COLUMNS).map(([kind, cols]) => (
              <div key={kind} className="grid gap-x-3 sm:grid-cols-[130px_1fr]">
                <dt className="font-mono text-xs text-fg">{kind}</dt>
                <dd className="font-mono text-xs break-words">{cols.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </div>
      </details>
    </div>
  )
}
