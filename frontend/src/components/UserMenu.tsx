import { LogOut, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { initials, ROLE_LABEL } from '@/lib/format'
import { useAuth } from '@/store/auth'
import { useTheme, type ThemePreference } from '@/store/theme'

const THEMES: { value: ThemePreference; label: string; Icon: LucideIcon }[] = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
]

export function UserMenu() {
  const user = useAuth((s) => s.user)
  const clear = useAuth((s) => s.clear)
  const preference = useTheme((s) => s.preference)
  const setPreference = useTheme((s) => s.setPreference)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  if (!user) return null

  const close = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1
    items[(next + items.length) % items.length]?.focus()
  }

  const signOut = () => {
    clear('signed_out')
    void navigate('/login', { replace: true })
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${user.full_name}`}
        onClick={() => { setOpen((v) => !v); }}
        className="grid size-8 place-items-center rounded-full border border-line-strong bg-raised text-xs font-semibold text-fg transition-colors duration-150 hover:border-fg-subtle"
      >
        {initials(user.full_name)}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-30 mt-2 w-64 rounded-card border border-line-strong bg-panel p-1.5 shadow-float"
        >
          <div className="flex flex-col gap-0.5 px-2.5 pb-2.5 pt-1.5">
            <span className="font-medium text-fg">{user.full_name}</span>
            <span className="truncate font-mono text-xs text-fg-muted">{user.email}</span>
            <span className="mt-1 w-fit rounded border border-line-strong px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
              {ROLE_LABEL[user.role]}
            </span>
          </div>
          <div role="group" aria-label="Theme" className="border-t border-line px-1 py-2">
            <span className="block px-1.5 pb-1.5 text-xs text-fg-subtle">Theme</span>
            <div className="grid grid-cols-3 gap-1">
              {THEMES.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={preference === value}
                  onClick={() => { setPreference(value); }}
                  className="flex flex-col items-center gap-1 rounded-md py-2 text-xs text-fg-muted transition-colors duration-150 hover:bg-raised hover:text-fg aria-checked:bg-selected aria-checked:font-medium aria-checked:text-fg"
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-line pt-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-fg transition-colors duration-150 hover:bg-raised"
            >
              <LogOut aria-hidden="true" className="size-4 text-fg-muted" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
