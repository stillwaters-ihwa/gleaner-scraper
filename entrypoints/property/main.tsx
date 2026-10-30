import React from 'react';
import ReactDOM from 'react-dom/client';
import { PropertyApp } from './PropertyApp';
import '../sidepanel/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PropertyApp />
  </React.StrictMode>,
);
