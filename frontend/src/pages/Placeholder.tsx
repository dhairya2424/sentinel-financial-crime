import { Compass } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/EmptyState'

interface PageProps {
  title: string
  meta?: ReactNode
  children: ReactNode
  wide?: boolean
}

export function Page({ title, meta, children, wide = false }: PageProps) {
  return (
    <div className={`flex w-full flex-col px-4 lg:px-8 ${wide ? 'gap-4 py-5 lg:py-6' : 'max-w-6xl gap-6 py-6 lg:py-8'}`}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {meta}
      </header>
      {children}
    </div>
  )
}

export function NotFoundScreen() {
  return (
    <Page title="Page not found">
      <EmptyState
        icon={Compass}
        title="This page doesn't exist"
        description="The address may be mistyped, or the page may belong to a phase that isn't built yet."
        action={
          <Link to="/" className="font-medium text-accent underline">
            Go to the dashboard
          </Link>
        }
      />
    </Page>
  )
}
