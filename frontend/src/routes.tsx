import type { RouteObject } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { RequireAuth, RequireRole } from '@/components/RequireAuth'
import { Dashboard } from '@/pages/Dashboard'
import { Login } from '@/pages/Login'
import {
  AlertDetailScreen,
  AlertsScreen,
  CaseDetailScreen,
  CasesScreen,
  NotFoundScreen,
  RulesScreen,
} from '@/pages/Placeholder'
import { AddData } from '@/pages/AddData'
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
          { path: 'alerts', element: <AlertsScreen /> },
          { path: 'alerts/:id', element: <AlertDetailScreen /> },
          { path: 'cases', element: <CasesScreen /> },
          { path: 'cases/:id', element: <CaseDetailScreen /> },
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
                <RulesScreen />
              </RequireRole>
            ),
          },
          { path: '*', element: <NotFoundScreen /> },
        ],
      },
    ],
  },
]
