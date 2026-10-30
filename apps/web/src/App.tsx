import { Route, Routes } from 'react-router';
import { RequireAuth } from './auth/require-auth';
import { AppShell } from './layout/app-shell';
import { NAV_ITEMS } from './layout/navigation';
import { ComingSoonPage } from './pages/coming-soon-page';
import { DashboardPage } from './pages/dashboard-page';
import { DocumentDetailPage } from './pages/document-detail-page';
import { DocumentsPage } from './pages/documents-page';
import { ForgotPasswordPage } from './pages/forgot-password-page';
import { LoginPage } from './pages/login-page';
import { NotFoundPage } from './pages/not-found-page';
import { ResetPasswordPage } from './pages/reset-password-page';
import { SettingsPage } from './pages/settings-page';
import { SignupPage } from './pages/signup-page';

/**
 * Route table. Rendered inside a router and an AuthProvider (see main.tsx).
 * Coming-soon pages are replaced by the phases that build them.
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path={NAV_ITEMS.documents.path} element={<DocumentsPage />} />
        <Route path={`${NAV_ITEMS.documents.path}/:documentId`} element={<DocumentDetailPage />} />
        <Route
          path={NAV_ITEMS.processing.path}
          element={<ComingSoonPage item={NAV_ITEMS.processing} />}
        />
        <Route path={NAV_ITEMS.review.path} element={<ComingSoonPage item={NAV_ITEMS.review} />} />
        <Route
          path={NAV_ITEMS.analytics.path}
          element={<ComingSoonPage item={NAV_ITEMS.analytics} />}
        />
        <Route
          path={NAV_ITEMS.auditLogs.path}
          element={<ComingSoonPage item={NAV_ITEMS.auditLogs} />}
        />
        <Route path={NAV_ITEMS.settings.path} element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
