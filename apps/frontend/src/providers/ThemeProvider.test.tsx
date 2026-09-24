import React from 'react';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeProvider, useThemeContext } from './ThemeProvider';

function ThemeConsumer() {
  const { theme, toggle } = useThemeContext();
  return (
    <div>
      <span data-testid="theme-value">{theme}</span>
      <button type="button" onClick={toggle}>
        Toggle
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('provides a default theme to children', () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme-value')).toHaveTextContent('light');
  });

  it('toggles the theme through the context consumer', () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('Toggle'));
    expect(screen.getByTestId('theme-value')).toHaveTextContent('dark');
    expect(localStorage.getItem('smile4money-theme')).toBe('dark');
  });

  it('reads an existing persisted theme preference', () => {
    localStorage.setItem('smile4money-theme', 'dark');
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme-value')).toHaveTextContent('dark');
  });

  it('exposes theme and toggle via useThemeContext', () => {
    const { result } = renderHook(() => useThemeContext(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(result.current.theme).toBe('light');
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('dark');
  });

  it('throws when used outside the provider', () => {
    expect(() => renderHook(() => useThemeContext())).toThrow(
      /useThemeContext must be used within a ThemeProvider/,
    );
  });
});