import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { App } from './App';
import { ApiError } from './api/client';
import { ConfirmProvider } from './components/Confirm';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

/**
 * A data router so a form can block navigation (useBlocker needs one). The route table itself
 * stays declarative in App's <Routes>, mounted under a single catch-all route.
 */
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    ),
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
