import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './styles/globals.css';
import './styles/components.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="bottom-right"
      containerClassName="toast-container"
      toastOptions={{
        duration: 3000,
        style: {
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-strong)',
          borderRadius: '10px',
          fontSize: '13px',
          fontFamily: 'var(--font-sans)',
          boxShadow: 'var(--shadow-lg)',
        },
        success: {
          iconTheme: { primary: '#34d399', secondary: 'var(--bg-elevated)' },
        },
        error: {
          iconTheme: { primary: '#ef4444', secondary: 'var(--bg-elevated)' },
        },
      }}
    />
  </React.StrictMode>
);
