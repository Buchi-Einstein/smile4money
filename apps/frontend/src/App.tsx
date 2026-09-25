import { ThemeProvider } from './providers/ThemeProvider';
import { WalletProvider } from './providers/WalletProvider';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppRouter } from './routes/AppRouter';

/**
 * App is only responsible for composing the global providers and the router.
 * Theme state lives in ThemeProvider, wallet state in WalletProvider, and
 * routes are declared in AppRouter.
 */
export function App() {
  return (
    <ThemeProvider>
      <WalletProvider>
        <ToastProvider>
          <ErrorBoundary>
            <AppRouter />
          </ErrorBoundary>
        </ToastProvider>
      </WalletProvider>
    </ThemeProvider>
  );
}