import { Card } from '../components/ui/card';
import { EmptyState } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import type { NavItem } from '../layout/navigation';

/** Stand-in for a section that a later phase builds. It says so plainly rather than showing fake content. */
export function ComingSoonPage({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader title={item.label} description={item.description} />
      <Card>
        <EmptyState
          icon={item.icon}
          title="Coming soon"
          description={`${item.label} is not available yet. This page will fill in as DocuMind's processing features are built.`}
          className="py-16"
        />
      </Card>
    </>
  );
}
