import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { createAuthClient } from './auth/auth-client';
import { AuthProvider } from './auth/auth-context';
import { loadWebConfig } from './config';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

const root = createRoot(rootElement);
let authClient;
try {
  authClient = createAuthClient(loadWebConfig(import.meta.env));
} catch (error) {
  // A misconfigured build shows why instead of a blank page.
  root.render(
    <p role="alert" style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      {error instanceof Error ? error.message : 'DocuMind failed to start.'}
    </p>,
  );
  throw error;
}

root.render(
  <StrictMode>
    <AuthProvider client={authClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
