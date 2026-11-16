import { createRoutesFromElements, Outlet, Route, ScrollRestoration } from 'react-router';
import { RequireAuth } from './auth/require-auth';
import { AuthLayout } from './components/auth-card';
import { AppShell } from './layout/app-shell';
import { NAV_ITEMS } from './layout/navigation';
import { AnalyticsPage } from './pages/analytics-page';
import { AuditLogsPage } from './pages/audit-logs-page';
import { DashboardPage } from './pages/dashboard-page';
import { DocumentDetailPage } from './pages/document-detail-page';
import { DocumentsPage } from './pages/documents-page';
import { ForgotPasswordPage } from './pages/forgot-password-page';
import { LoginPage } from './pages/login-page';
import { NotFoundPage } from './pages/not-found-page';
import { ProcessingPage } from './pages/processing-page';
import { ResetPasswordPage } from './pages/reset-password-page';
import { ReviewPage } from './pages/review-page';
import { SettingsPage } from './pages/settings-page';
import { SignupPage } from './pages/signup-page';

/**
 * Route table for a data router (createBrowserRouter in main.tsx), rendered
 * inside an AuthProvider. The signed-out pages other than sign in share one layout, so the card
 * and brand panel stay mounted between them.
 */
export const routes = createRoutesFromElements(
  // ScrollRestoration: new pages open at the top; Back and Forward return to where the user was.
  <Route
    element={
      <>
        <ScrollRestoration />
        <Outlet />
      </>
    }
  >
    {/* Sign in has its own split-screen layout. */}
    <Route path="/login" element={<LoginPage />} />
    <Route element={<AuthLayout />}>
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
    </Route>
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
      <Route path={NAV_ITEMS.processing.path} element={<ProcessingPage />} />
      <Route path={NAV_ITEMS.review.path} element={<ReviewPage />} />
      <Route path={NAV_ITEMS.analytics.path} element={<AnalyticsPage />} />
      <Route path={NAV_ITEMS.auditLogs.path} element={<AuditLogsPage />} />
      <Route path={NAV_ITEMS.settings.path} element={<SettingsPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Route>,
);
