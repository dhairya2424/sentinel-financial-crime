import { useEffect, useState } from 'react'
import { previewEvent } from '@/api/entities'
import type { EventPreview, IngestEvent } from '@/api/types'

export type PreviewState = { status: 'incomplete' } | { status: 'loading' } | { status: 'ready'; preview: EventPreview } | { status: 'error'; message: string }

/** Ask the server how an unsaved event will read on the Timeline, debounced while the form is being typed into. */
export function usePreview(event: IngestEvent | null): PreviewState {
  const key = event ? JSON.stringify(event) : null
  const [result, setResult] = useState<{ key: string; state: PreviewState } | null>(null)

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      previewEvent(JSON.parse(key) as IngestEvent, controller.signal)
        .then((preview) => {
          setResult({ key, state: { status: 'ready', preview } })
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) setResult({ key, state: { status: 'error', message: err instanceof Error ? err.message : String(err) } })
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key])

  if (!key) return { status: 'incomplete' }
  return result?.key === key ? result.state : { status: 'loading' }
}
