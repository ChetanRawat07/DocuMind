import { NavLink } from 'react-router';
import { Avatar } from '../components/ui/avatar';
import { BrandMark } from '../components/ui/brand-mark';
import { cx } from '../lib/cx';
import { pageQuery } from '../services/page-queries';
import { useApi } from '../services/use-api';
import { prefetchApiQuery } from '../services/use-api-query';
import { NAV_ITEMS, NAV_SECTIONS, type NavItem } from './navigation';

function SidebarLink({
  item,
  onNavigate,
  count,
}: {
  item: NavItem;
  onNavigate: (() => void) | undefined;
  /** Items waiting on this page, shown as a badge; hidden at zero. */
  count?: string | null;
}) {
  const Icon = item.icon;
  const api = useApi();
  // Pointing at or focusing a link starts loading its page, so it often opens with data.
  const prefetch = () => {
    const query = pageQuery(item.path);
    if (query) prefetchApiQuery(api, query.path, query.schema);
  };
  return (
    // No `end`: a section stays highlighted on its nested pages (/documents/:id).
    // React Router already matches the root link "/" only exactly.
    <NavLink
      to={item.path}
      aria-label={count ? `${item.label}, ${count} waiting` : undefined}
      onClick={onNavigate}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      viewTransition
      className={({ isActive }) =>
        cx(
          'flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-compact transition-colors duration-150',
          // The accent ring is too faint on navy; the light one keeps 3:1.
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-showcase-fg',
          isActive
            ? 'bg-showcase-raised font-medium text-showcase-fg shadow-[inset_2px_0_0_var(--color-accent)]'
            : 'text-showcase-muted hover:bg-showcase-raised hover:text-showcase-fg',
        )
      }
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {item.label}
      {count ? (
        <span
          aria-hidden="true"
          className="ml-auto rounded-md bg-showcase-line px-1.5 font-mono text-xs leading-4 text-showcase-fg tabular-nums"
        >
          {count}
        </span>
      ) : null}
    </NavLink>
  );
}

/**
 * Brand plus navigation, with Settings and the signed-in user at the foot.
 * Rendered fixed on wide screens and inside the mobile drawer; `onNavigate`
 * lets the drawer close when a link is followed.
 */
export function SidebarContent({
  onNavigate,
  userName,
  reviewCount,
}: {
  onNavigate?: () => void;
  userName: string;
  reviewCount: string | null;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center border-b border-showcase-line px-4">
        <BrandMark className="text-showcase-fg" />
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col overflow-y-auto p-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="mt-5 mb-1.5 px-2.5 text-xs font-medium text-showcase-muted">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.path}>
                  <SidebarLink
                    item={item}
                    onNavigate={onNavigate}
                    count={item === NAV_ITEMS.review ? reviewCount : null}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="mt-auto space-y-1 border-t border-showcase-line pt-2">
          <SidebarLink item={NAV_ITEMS.settings} onNavigate={onNavigate} />
          <p className="flex h-10 items-center gap-2.5 px-2.5 text-compact font-medium text-showcase-fg">
            <Avatar name={userName} className="size-6" />
            <span className="truncate">{userName}</span>
          </p>
        </div>
      </nav>
    </div>
  );
}
