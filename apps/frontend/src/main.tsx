import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './app/globals.css';
// Layout + component styles for CreateMatch / DepositStake / MatchStatus.
// Imported here because nothing else pulls it in — see the header of the file
// for why these three components were previously unstyled.
import './styles/match-ui.css';
import './styles/global-ui.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);