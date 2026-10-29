import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from './auth/require-auth';
import { ForgotPasswordPage } from './pages/forgot-password-page';
import { HomePage } from './pages/home-page';
import { LoginPage } from './pages/login-page';
import { ResetPasswordPage } from './pages/reset-password-page';
import { SignupPage } from './pages/signup-page';

/** Route table. Rendered inside a router and an AuthProvider (see main.tsx). */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <HomePage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
