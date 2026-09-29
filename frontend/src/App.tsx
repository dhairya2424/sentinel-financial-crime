import { createBrowserRouter, RouterProvider } from 'react-router'
import { HealthMonitor } from '@/components/HealthMonitor'
import { routes } from '@/routes'
import { useThemeSync } from '@/store/theme'

const router = createBrowserRouter(routes)

export function App() {
  useThemeSync()
  return (
    <>
      <HealthMonitor />
      <RouterProvider router={router} />
    </>
  )
}
