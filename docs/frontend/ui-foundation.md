# UI foundation

How the web app's interface is put together: design tokens, the component kit, the signed-in
layout, loading/empty/error states and accessibility. The visual direction comes from the DocuMind
UI concept (light, minimal, blue accent, clean cards); this document records how it was turned into
reusable components. The decision to hand-build the kit is [ADR-014](../adr/014-hand-built-ui-kit.md).

## Design tokens

Defined once in `apps/web/src/index.css` with Tailwind v4's `@theme`, so they become utilities
(`bg-canvas`, `text-brand-700`, ...). Components use these names, never raw hex values.

| Token                        | Value                     | Use                                          |
| ---------------------------- | ------------------------- | -------------------------------------------- |
| `--color-canvas`             | `#f7f8fa`                 | Page background behind cards                 |
| `--color-brand-50` … `-800`  | Blue scale, 600 `#2563eb` | Primary actions, active navigation, links    |
| Tailwind `gray-*`            | Built in                  | Text, borders, neutral surfaces              |
| Tailwind `green/amber/red-*` | Built in                  | Status tones (success, warning, danger)      |
| `--font-sans`                | Inter Variable            | Self-hosted via `@fontsource-variable/inter` |

The theme is light only (`color-scheme: light`), as the plan specifies.

**Typography scale:** page title `text-2xl font-bold` (the page's only `h1`), card title
`text-sm font-semibold` (`h2`), body `text-sm`, secondary text `text-xs`/`text-sm` in `gray-500`.
Secondary text is `gray-500` rather than the concept's lighter gray because the lighter shade fails
WCAG AA contrast (4.5:1) on white.

## Layout

```text
┌──────────────┬───────────────────────────────────────────────┐
│ Sidebar      │ Top bar: [☰ <lg] Workspace › Page   [Account] │  sticky
│ (fixed, ≥lg) ├───────────────────────────────────────────────┤
│  Workspace   │ <main id="main-content">                      │
│  Insights    │   PageHeader (h1 + subtitle + tab title)      │
│  ─────────   │   cards…                                      │
│  Settings    │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

- `layout/navigation.ts` is the single list of pages (path, label, icon, description). The sidebar,
  breadcrumb, routes and page subtitles all read from it.
- `layout/app-shell.tsx` loads the profile once (`GET /me`), shows a spinner or a retryable error
  while it can't, and then provides it to pages through `useCurrentUser()`.
- From the `lg` breakpoint (1024px) the sidebar is fixed. Below it, the top bar's menu button opens
  the same navigation in a drawer (`layout/mobile-nav.tsx`).
- Pages that later phases build (Processing, Review, Analytics, Audit Logs) render
  `ComingSoonPage`, which says plainly that the section is not available yet. Documents and the
  document detail page (`/documents/:id`, breadcrumb "Documents › Details") are described in
  [document-management.md](../documents/document-management.md).

## Component kit (`apps/web/src/components/ui`)

| Component                            | Purpose                                                              |
| ------------------------------------ | -------------------------------------------------------------------- |
| `Button`, `buttonClasses()`          | Primary / secondary / ghost, two sizes; `buttonClasses` styles links |
| `Card`, `CardHeader`                 | White bordered surface; header with `h2` title, description, action  |
| `PageHeader`                         | Page `h1`, subtitle, actions; sets the browser tab title             |
| `StatCard`                           | One KPI; `value={null}` shows "—" and reads "No data yet"            |
| `StatusBadge`, `DocumentStatusBadge` | Status pill with text label; tone only reinforces the label          |
| `BarChart`, `MeterList`              | Simple charts; values also exposed as text for screen readers        |
| `EmptyState`                         | Icon, title, explanation, optional action                            |
| `ErrorState`                         | `role="alert"`, fixed message, "Try again" button                    |
| `Spinner`, `Skeleton`                | Announced loading text; decorative placeholder blocks                |
| `Avatar`, `BrandMark`                | Initials circle; logo tile                                           |

Document-specific: `components/documents/document-table.tsx` (filename with upload time, type,
status). Display text for statuses and types lives in `lib/document-labels.ts` as
`Record<DocumentStatus, …>`, so adding a status to the shared contract is a compile error until it
has a label.

## Loading, empty and error states

Every view that loads data handles all three, using `services/use-api-query.ts`:

```ts
const recent = useApiQuery('/documents?limit=5', documentListResponseSchema);
// recent.status: 'loading' | 'error' | 'success'; recent.retry() reloads
```

- Responses are validated against the shared Zod schema; a mismatch is an error state, not bad data
  on screen.
- Each result is tagged with the request it answers, so a retry or a changed path shows loading at
  once, and a late response for an old request is never shown. Leaving the page aborts the request.
- Error messages are fixed text ("Could not load documents"). Server error messages are never
  rendered.
- **No invented numbers.** Until an API provides a metric, its card shows "—" / "No data yet". The
  dashboard's KPIs, activity chart and type breakdown stay in this state until analytics (Phase 12).

## Accessibility

| Practice                                                                                                           | Where                                |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Landmarks: `nav[aria-label=Main]`, breadcrumb `nav`, `main`                                                        | Shell                                |
| Skip link to `#main-content`                                                                                       | First focusable element in the shell |
| Focus moves to `main` after each client-side navigation                                                            | `AppShell`                           |
| Active link has `aria-current="page"` (NavLink)                                                                    | Sidebar                              |
| Drawer is a modal dialog; the page behind it is `inert`; Escape and backdrop close it; focus returns to the opener | `MobileNav`                          |
| Account menu is a disclosure (`aria-expanded`), not an ARIA menu; Escape and outside clicks close it               | `UserMenu`                           |
| Visible `focus-visible` outlines on every control                                                                  | Buttons, links, inputs               |
| Status shown as text, not color alone                                                                              | `StatusBadge`, `StatCard`            |
| Charts expose numbers as a table or text                                                                           | `BarChart`, `MeterList`              |
| Animations only under `motion-safe:`                                                                               | Spinner, skeletons                   |
| One `h1` per page; cards use `h2`                                                                                  | `PageHeader`, `CardHeader`           |

**How it is checked:** `apps/web/src/a11y.spec.tsx` runs axe-core on every screen (auth pages,
dashboard, settings, a placeholder page, 404, and with the drawer and account menu open). jsdom
cannot compute color contrast, so contrast was checked by running axe in headless Chrome against
the rendered app during Phase 3 (no violations). Automated checks find a subset of problems; a
manual screen-reader pass is still worth doing before a demo.

## Adding a page

1. Add an entry to `NAV_ITEMS` in `layout/navigation.ts` (and to a section in `NAV_SECTIONS` if it
   belongs in the sidebar).
2. Add a route under the shell in `App.tsx`.
3. Start the page with `<PageHeader>`; build it from `Card` and the state components; load data with
   `useApiQuery` and a shared schema.
4. Add tests for its loading, empty and error states; the a11y spec covers structure if you add the
   path to it.

## Known limitations

- No dark mode (the plan specifies a light UI).
- The bundle is not split by route (about 237 KB gzipped, mostly supabase-js and React); revisit in
  the performance phase.
- Relative times ("5 minutes ago") are computed when the page opens and do not tick.
