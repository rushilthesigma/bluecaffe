import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// lightweight runtime-error tracker the UI Check panel reads
const w = window as unknown as { __uiErrors: { count: number; last: string | null } };
w.__uiErrors = { count: 0, last: null };
window.addEventListener('error', (e) => { w.__uiErrors.count++; w.__uiErrors.last = e.message; });
window.addEventListener('unhandledrejection', (e) => { w.__uiErrors.count++; w.__uiErrors.last = String(e.reason); });
const origErr = console.error.bind(console);
console.error = (...a: unknown[]) => { w.__uiErrors.count++; w.__uiErrors.last = a.map(String).join(' '); origErr(...a); };

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
