import './styles.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Link, RouterProvider } from 'react-router'
import { ApiError } from './api/client'
import { AppShell } from './components/AppShell'
import { EmptyState } from './components/ui'
import { LoginPage } from './features/auth/LoginPage'
import { NetworkPage } from './features/network/NetworkPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Erro de sessão ou de permissão não melhora com nova tentativa
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
})

const router = createBrowserRouter([
  { path: '/entrar', element: <LoginPage /> },
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <NetworkPage /> },
      {
        // O detalhe carrega sob demanda: o ECharts só é baixado quando um ambiente é aberto
        path: '/ambientes/:id',
        lazy: async () => ({
          Component: (await import('./features/environment/EnvironmentPage')).EnvironmentPage,
        }),
      },
      {
        path: '*',
        element: (
          <EmptyState title="Página não encontrada">
            <Link to="/" className="font-medium text-celsius">
              Ir para a visão da rede
            </Link>
          </EmptyState>
        ),
      },
    ],
  },
])

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
