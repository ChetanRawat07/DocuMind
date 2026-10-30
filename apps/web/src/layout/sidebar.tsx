import { NavLink } from 'react-router';
import { BrandMark } from '../components/ui/brand-mark';
import { cx } from '../lib/cx';
import { NAV_ITEMS, NAV_SECTIONS, type NavItem } from './navigation';

function SidebarLink({
  item,
  onNavigate,
}: {
  item: NavItem;
  onNavigate: (() => void) | undefined;
}) {
  const Icon = item.icon;
  return (
    // No `end`: a section stays highlighted on its nested pages (/documents/:id).
    // React Router already matches the root link "/" only exactly.
    <NavLink
      to={item.path}
      onClick={onNavigate}
      className={({ isActive }) =>
        cx(
          'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
          isActive
            ? 'bg-brand-50 font-semibold text-brand-800'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
        )
      }
    >
      <Icon aria-hidden="true" className="size-4.5 shrink-0" />
      {item.label}
    </NavLink>
  );
}

/**
 * Brand plus navigation. Rendered fixed on wide screens and inside the mobile
 * drawer; `onNavigate` lets the drawer close when a link is followed.
 */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col px-3.5 py-5">
      <BrandMark className="px-2.5 pb-3" />
      <nav aria-label="Main" className="flex flex-1 flex-col">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="mt-5 mb-2 px-2.5 text-[0.6875rem] font-semibold tracking-widest text-gray-500 uppercase">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.path}>
                  <SidebarLink item={item} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="mt-auto border-t border-gray-100 pt-3">
          <SidebarLink item={NAV_ITEMS.settings} onNavigate={onNavigate} />
        </div>
      </nav>
    </div>
  );
}
