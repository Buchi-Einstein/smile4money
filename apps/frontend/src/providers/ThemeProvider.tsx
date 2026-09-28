import { createContext, useContext, type ReactNode, type JSX } from 'react';
import { useTheme } from '../hooks/useTheme';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Provides the current colour theme and a `toggle` action to every component
 * under it. The persisted preference lives in `useTheme`.
 */
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const { theme, toggle } = useTheme();
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeContext must be used within a ThemeProvider');
  }
  return context;
}