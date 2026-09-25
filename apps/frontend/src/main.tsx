import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { App } from './App';
import { NotFound } from './pages/NotFound';
import { ToastProvider } from './components/Toast';
import './app/globals.css';
// Layout + component styles for CreateMatch / DepositStake / MatchStatus.
// Imported here because nothing else pulls it in — see the header of the file
// for why these three components were previously unstyled.
import './styles/match-ui.css';
import './styles/global-ui.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </React.StrictMode>,
);
