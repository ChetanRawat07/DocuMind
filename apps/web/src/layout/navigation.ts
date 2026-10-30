import {
  ChartColumn,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  Settings,
  Workflow,
} from 'lucide-react';

export interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** One line describing the page, used as its subtitle. */
  readonly description: string;
}

/** Every page in the signed-in app. The sidebar, breadcrumb and routes all read from here. */
export const NAV_ITEMS = {
  dashboard: {
    path: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    description: "Here's what's happening with your documents.",
  },
  documents: {
    path: '/documents',
    label: 'Documents',
    icon: FileText,
    description: 'Upload, search and manage your documents.',
  },
  processing: {
    path: '/processing',
    label: 'Processing',
    icon: Workflow,
    description: 'Queued, running, completed and failed processing jobs.',
  },
  review: {
    path: '/review',
    label: 'Review',
    icon: ClipboardCheck,
    description: 'Low-confidence fields waiting for a human check.',
  },
  analytics: {
    path: '/analytics',
    label: 'Analytics',
    icon: ChartColumn,
    description: 'Processing volume, success rates and extraction confidence.',
  },
  auditLogs: {
    path: '/audit-logs',
    label: 'Audit Logs',
    icon: ScrollText,
    description: 'A record of significant actions in your workspace.',
  },
  settings: {
    path: '/settings',
    label: 'Settings',
    icon: Settings,
    description: 'Your profile, session and workspace preferences.',
  },
} as const satisfies Record<string, NavItem>;

export interface NavSection {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: 'Workspace',
    items: [NAV_ITEMS.dashboard, NAV_ITEMS.documents, NAV_ITEMS.processing, NAV_ITEMS.review],
  },
  { label: 'Insights', items: [NAV_ITEMS.analytics, NAV_ITEMS.auditLogs] },
];

/** Breadcrumb trail for a path: section then page, or just the page for Settings. */
export function breadcrumbFor(pathname: string): readonly string[] {
  for (const section of NAV_SECTIONS) {
    const item = section.items.find((candidate) => candidate.path === pathname);
    if (item) return [section.label, item.label];
  }
  return pathname === NAV_ITEMS.settings.path ? [NAV_ITEMS.settings.label] : [];
}
