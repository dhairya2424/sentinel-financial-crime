import { useEffect, useLayoutEffect, useRef } from 'react'

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
export const modKeyLabel = isMac ? '⌘' : 'Ctrl'
export const modKeyAria = isMac ? 'Meta' : 'Control'

export function useHotkey(key: string, handler: (event: KeyboardEvent) => void): void {
  const handlerRef = useRef(handler)
  useLayoutEffect(() => {
    handlerRef.current = handler
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = isMac ? event.metaKey : event.ctrlKey
      if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === key) {
        event.preventDefault()
        handlerRef.current(event)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [key])
}
