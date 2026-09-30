import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { fetchMe } from '@/api/auth'
import { useHotkey } from '@/hooks/useHotkey'
import { useAuth } from '@/store/auth'
import { useUi } from '@/store/ui'
import { useAlertFeed } from '@/ws/useAlertFeed'
import { useSocketLifecycle } from '@/ws/useSocket'
import { ConnectionBanner } from './ConnectionBanner'
import { LiveBanner } from './LiveBanner'
import { Sidebar } from './Sidebar'
import { StatusStrip } from './StatusStrip'
import { Toaster } from './Toaster'
import { Topbar } from './Topbar'

export function AppShell() {
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  useHotkey('b', toggleSidebar)
  useSocketLifecycle()
  useAlertFeed()

  useEffect(() => {
    const controller = new AbortController()
    void fetchMe(controller.signal)
      .then((user) => {
        useAuth.getState().setUser(user)
      })
      .catch(() => undefined)
    return () => {
      controller.abort()
    }
  }, [])

  return (
    <div className="flex h-full bg-canvas text-fg">
      <a
        href="#main"
        className="sr-only rounded-md bg-panel px-3 py-2 text-[13px] font-medium text-fg shadow-card focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <ConnectionBanner />
        <LiveBanner />
        <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col overflow-y-auto focus:outline-none">
          <Outlet />
        </main>
        <StatusStrip />
      </div>
      <Toaster />
    </div>
  )
}
