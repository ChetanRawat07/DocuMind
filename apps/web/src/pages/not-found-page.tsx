import { FileQuestion } from 'lucide-react';
import { Link } from 'react-router';
import { buttonClasses } from '../components/ui/button-styles';
import { Card } from '../components/ui/card';
import { EmptyState } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { NAV_ITEMS } from '../layout/navigation';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <Card>
        <EmptyState
          icon={FileQuestion}
          title="This page doesn't exist"
          description="The link may be out of date, or the address may have a typo."
          action={
            <Link to={NAV_ITEMS.dashboard.path} className={buttonClasses('secondary', 'sm')}>
              Go to the dashboard
            </Link>
          }
          className="py-16"
        />
      </Card>
    </>
  );
}
