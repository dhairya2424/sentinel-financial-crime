import type { RouteObject } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { RequireAuth, RequireRole } from '@/components/RequireAuth'
import { Dashboard } from '@/pages/Dashboard'
import { Login } from '@/pages/Login'
import { NotFoundScreen } from '@/pages/Placeholder'
import { RulesPage } from '@/pages/Rules'
import { CaseDetail } from '@/pages/CaseDetail'
import { CaseManager } from '@/pages/CaseManager'
import { AddData } from '@/pages/AddData'
import { AlertInbox } from '@/pages/AlertInbox'
import { GraphExplorer } from '@/pages/GraphExplorer'
import { DATA_ENTRY_ROLES } from '@/lib/screens'
import { TimelineIndexScreen, TimelineScreen } from '@/pages/Timeline'

export const routes: RouteObject[] = [
  { path: '/login', element: <Login /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: 'alerts', element: <AlertInbox /> },
          { path: 'alerts/:id', element: <AlertInbox /> },
          { path: 'cases', element: <CaseManager /> },
          { path: 'cases/:id', element: <CaseDetail /> },
          { path: 'graph', element: <GraphExplorer /> },
          { path: 'timeline', element: <TimelineIndexScreen /> },
          { path: 'timeline/:type/:id', element: <TimelineScreen /> },
          {
            path: 'add',
            element: (
              <RequireRole role={DATA_ENTRY_ROLES} area="Add data">
                <AddData />
              </RequireRole>
            ),
          },
          {
            path: 'admin/rules',
            element: (
              <RequireRole role="admin" area="Admin / Rules">
                <RulesPage />
              </RequireRole>
            ),
          },
          { path: '*', element: <NotFoundScreen /> },
        ],
      },
    ],
  },
]
