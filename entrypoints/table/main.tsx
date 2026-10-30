import React from 'react';
import ReactDOM from 'react-dom/client';
import { TableApp } from './TableApp';
import '../sidepanel/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TableApp />
  </React.StrictMode>,
);
