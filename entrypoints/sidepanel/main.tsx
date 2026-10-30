import React from 'react';
import ReactDOM from 'react-dom/client';
import { browser } from 'wxt/browser';
import App from './App';
import './styles.css';

// Lets the background script clear page highlights when the panel closes.
browser.runtime.connect({ name: 'sidepanel' });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
