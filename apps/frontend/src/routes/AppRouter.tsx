import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Home } from '../pages/Home';
import { NotFound } from '../pages/NotFound';

/**
 * Application route configuration. Kept separate from `App` so that adding or
 * removing routes never requires touching the provider composition.
 */
export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}