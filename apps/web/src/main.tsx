import './styles.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { createQueryClient } from './api/query-client'
import { AppShell } from './components/AppShell'
import { HintProvider } from './components/Hint'
import { LoginPage } from './features/auth/LoginPage'
import { NotFoundPage } from './features/errors/NotFoundPage'
import { RouteError } from './features/errors/RouteError'
import { NetworkPage } from './features/network/NetworkPage'

// 401 global: zera a sessão, marca a expiração e a casca leva ao login (api/query-client.ts)
const queryClient = createQueryClient()

// Vitrine dos componentes: só no dev server; o build de produção nem chega a gerar o chunk
const devRoutes = import.meta.env.DEV
  ? [{ path: '/_componentes', lazy: () => import('./components/showcase/Showcase') }]
  : []

const router = createBrowserRouter([
  {
    // Raiz: erro no login ou na própria casca vira a página da marca, nunca a pilha crua
    errorElement: <RouteError />,
    children: [
      ...devRoutes,
      { path: '/entrar', element: <LoginPage /> },
      {
        element: <AppShell />,
        children: [
          {
            // Casca: erro numa tela aparece dentro do cabeçalho, que continua navegável. No acesso
            // direto a uma tela sob demanda, a casca já aparece e só o conteúdo espera o chunk
            errorElement: <RouteError inShell />,
            hydrateFallbackElement: (
              <div aria-busy="true" className="min-h-96">
                <span className="so-leitor">Carregando</span>
              </div>
            ),
            children: [
              { path: '/', element: <NetworkPage /> },
              {
                // Detalhe e qualidade carregam sob demanda: o ECharts só desce quando um ambiente abre
                path: '/ambientes/:id',
                lazy: async () => ({
                  Component: (await import('./features/environment/EnvironmentPage')).EnvironmentPage,
                }),
              },
              {
                path: '/qualidade',
                lazy: async () => ({
                  Component: (await import('./features/quality/QualityPage')).QualityPage,
                }),
              },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
])

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HintProvider>
        <RouterProvider router={router} />
      </HintProvider>
    </QueryClientProvider>
  </StrictMode>,
)
