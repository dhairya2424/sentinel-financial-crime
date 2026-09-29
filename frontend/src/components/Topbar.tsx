import { Building2, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { modKeyAria, modKeyLabel, useHotkey } from '@/hooks/useHotkey'
import { useAuth } from '@/store/auth'
import { UserMenu } from './UserMenu'

export function Topbar() {
  const tenant = useAuth((s) => s.user?.tenant_id)
  const inputRef = useRef<HTMLInputElement>(null)
  const [hint, setHint] = useState(false)

  useHotkey('k', () => {
    inputRef.current?.focus()
    inputRef.current?.select()
  })

  useEffect(() => {
    if (!hint) return
    const id = window.setTimeout(() => {
      setHint(false)
    }, 5000)
    return () => {
      window.clearTimeout(id)
    }
  }, [hint])

  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-line bg-panel px-4 lg:px-6">
      <form
        role="search"
        className="relative w-full max-w-[360px]"
        onSubmit={(event) => {
          event.preventDefault()
          setHint(true)
        }}
      >
        <label htmlFor="global-search" className="sr-only">
          Search customers, accounts and employees
        </label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
        <input
          ref={inputRef}
          id="global-search"
          type="search"
          autoComplete="off"
          aria-keyshortcuts={`${modKeyAria}+K`}
          placeholder="Search customers, accounts, employees"
          onChange={() => { setHint(false); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setHint(false)
              event.currentTarget.blur()
            }
          }}
          className="h-8 w-full rounded-md border border-line-strong bg-canvas pl-8 pr-3 text-[13px] sm:pr-14 text-fg transition-colors duration-150 placeholder:text-fg-subtle hover:border-fg-subtle focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded sm:block border border-line-strong px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted">
          {modKeyLabel} K
        </kbd>
        {hint && (
          <p
            role="status"
            className="absolute left-0 top-full z-20 mt-1.5 w-full rounded-md border border-line-strong bg-panel px-3 py-2 text-xs text-fg-muted shadow-float"
          >
            Entity search arrives in Phase 2, with the Graph Explorer.
          </p>
        )}
      </form>
      <div className="ml-auto flex items-center gap-3">
        {tenant && (
          <span
            title="Tenant"
            className="hidden items-center gap-1.5 rounded-md border border-line px-2 py-1 font-mono text-xs text-fg-muted md:inline-flex"
          >
            <Building2 aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Tenant </span>
            {tenant}
          </span>
        )}
        <UserMenu />
      </div>
    </header>
  )
}
