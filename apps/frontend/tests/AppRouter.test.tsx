import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { AppRouter } from '../src/routes/AppRouter';
import { ThemeProvider } from '../src/providers/ThemeProvider';
import { WalletProvider } from '../src/providers/WalletProvider';
import { ToastProvider } from '../src/components/Toast';

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <WalletProvider>
        <ToastProvider>{ui}</ToastProvider>
      </WalletProvider>
    </ThemeProvider>,
  );
}

describe('AppRouter', () => {
  afterEach(() => {
    cleanup();
    window.history.pushState({}, '', '/');
  });

  it('renders the home screen at the root route', () => {
    renderWithProviders(<AppRouter />);
    expect(screen.getByTestId('network-badge')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument();
  });

  it('renders the NotFound page for unknown routes', () => {
    window.history.pushState({}, '', '/does-not-exist');
    renderWithProviders(<AppRouter />);
    expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });
});