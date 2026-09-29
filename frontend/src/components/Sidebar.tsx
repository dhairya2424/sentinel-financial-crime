import { PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react'
import { Link, NavLink } from 'react-router'
import { modKeyAria, modKeyLabel } from '@/hooks/useHotkey'
import { Logo } from './Logo'
import { NAV } from '@/lib/screens'
import { useAuth } from '@/store/auth'
import { useUi } from '@/store/ui'

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const toggle = useUi((s) => s.toggleSidebar)
  const role = useAuth((s) => s.user?.role)
  const main = NAV.filter((item) => !item.adminOnly && (!item.roles || (role !== undefined && item.roles.includes(role))))
  const admin = role === 'admin' ? NAV.filter((item) => item.adminOnly) : []
  const labelClass = collapsed ? 'sr-only' : 'sr-only lg:not-sr-only'

  const link = (to: string, title: string, Icon: LucideIcon) => (
    <li key={to}>
      <NavLink
        to={to}
        end={to === '/'}
        title={title}
        className={({ isActive }) =>
          `group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors duration-150 ease-out ${
            isActive ? 'bg-selected font-medium text-fg' : 'text-fg-muted hover:bg-raised hover:text-fg'
          }`
        }
      >
        <Icon aria-hidden="true" className="size-[18px] shrink-0 group-aria-[current=page]:text-accent" />
        <span className={`truncate whitespace-nowrap ${labelClass}`}>{title}</span>
      </NavLink>
    </li>
  )

  return (
    <nav
      aria-label="Primary"
      data-collapsed={collapsed}
      className={`flex shrink-0 flex-col border-r border-line bg-panel transition-[width] duration-200 ease-out ${
        collapsed ? 'w-16' : 'w-16 lg:w-40'
      }`}
    >
      <Link to="/" aria-label="Sentinel, go to dashboard" className="flex h-13 shrink-0 items-center px-[18px]">
        <Logo wordmarkClassName={labelClass} />
      </Link>
      <ul className="flex flex-col gap-0.5 px-1.5 pt-2">{main.map((i) => link(i.to, i.screen.title, i.screen.Icon))}</ul>
      {admin.length > 0 && (
        <>
          <div className="mx-4 my-3 h-px bg-line" />
          <ul className="flex flex-col gap-0.5 px-1.5">{admin.map((i) => link(i.to, i.screen.title, i.screen.Icon))}</ul>
        </>
      )}
      <div className="mt-auto hidden p-1.5 lg:block">
        <button
          type="button"
          onClick={toggle}
          aria-keyshortcuts={`${modKeyAria}+B`}
          title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (${modKeyLabel}+B)`}
          className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-fg-muted transition-colors duration-150 hover:bg-raised hover:text-fg"
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" className="size-[18px] shrink-0" />
          ) : (
            <PanelLeftClose aria-hidden="true" className="size-[18px] shrink-0" />
          )}
          <span className={`whitespace-nowrap ${labelClass}`}>{collapsed ? 'Expand sidebar' : 'Collapse'}</span>
          {!collapsed && (
            <kbd className="ml-auto hidden whitespace-nowrap rounded border border-line-strong px-1 py-px font-mono text-[10px] leading-4 text-fg-muted lg:block">
              {modKeyLabel} B
            </kbd>
          )}
        </button>
      </div>
    </nav>
  )
}
