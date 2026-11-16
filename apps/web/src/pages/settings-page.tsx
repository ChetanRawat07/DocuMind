import { LogOut } from 'lucide-react';
import { displayNameOf, useCurrentUser } from '../auth/current-user';
import { useSignOut } from '../auth/use-sign-out';
import { ApiStatusIndicator } from '../components/api-status';
import { EraseDataCard } from '../components/settings/erase-data-card';
import { Button } from '../components/ui/button';
import { Card, CardHeader } from '../components/ui/card';
import { PageHeader } from '../components/ui/page-header';
import { NAV_ITEMS } from '../layout/navigation';
import { formatDate } from '../lib/format';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-compact text-fg-muted">{label}</dt>
      <dd className="mt-1 text-compact break-words text-fg sm:col-span-2 sm:mt-0">{value}</dd>
    </div>
  );
}

export function SettingsPage() {
  const user = useCurrentUser();
  const signOut = useSignOut();

  return (
    <>
      <PageHeader title={NAV_ITEMS.settings.label} description={NAV_ITEMS.settings.description} />
      <div className="max-w-3xl space-y-4">
        <Card className="p-4 sm:p-6">
          <CardHeader title="Profile" description="From your sign-up details." />
          <dl className="mt-3 divide-y divide-line-subtle">
            <Field label="Name" value={displayNameOf(user)} />
            <Field label="Email" value={user.email} />
            <Field label="Member since" value={formatDate(user.createdAt)} />
          </dl>
        </Card>

        <Card className="p-4 sm:p-6">
          <CardHeader
            title="Session"
            description="Signing out removes your session from this browser."
            action={
              <Button variant="secondary" size="sm" onClick={() => void signOut()}>
                <LogOut aria-hidden="true" className="size-4" />
                Sign out
              </Button>
            }
          />
        </Card>

        <Card className="p-4 sm:p-6">
          <CardHeader title="Service status" />
          <div className="mt-3 text-fg-secondary">
            <ApiStatusIndicator />
          </div>
        </Card>

        <EraseDataCard />
      </div>
    </>
  );
}
