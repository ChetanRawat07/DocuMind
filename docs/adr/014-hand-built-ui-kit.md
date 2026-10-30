# ADR-014: Hand-built UI kit on Tailwind CSS

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Phase 3 turns the DocuMind UI concept (a single static HTML page) into the product's interface:
layout, cards, status badges, loading/empty/error states and accessible controls. The app already
uses Tailwind CSS 4. The concept's visual language is small: one accent color, gray neutrals,
cards, pills and a sidebar. The project values understandability (every part should be explainable
in an interview) and zero cost.

## Decision

Build a small component kit in `apps/web/src/components/ui` with Tailwind utilities and design
tokens declared in `@theme`. Add only two runtime dependencies:

- `lucide-react` for icons (tree-shaken: only imported icons are bundled).
- `@fontsource-variable/inter` to self-host the Inter font, so the app makes no third-party font
  requests (simpler privacy story and Content-Security-Policy).

Interactive patterns (drawer, account menu) are written by hand on documented ARIA patterns, with
`inert` for the modal drawer. `axe-core` is added as a dev dependency to test accessibility.

## Alternatives

- **A component library (MUI, Mantine, Chakra):** many ready components and strong accessibility,
  but a second styling system next to Tailwind, a large bundle, and a look that would need
  overriding to match the concept.
- **shadcn/ui on Radix primitives:** good accessibility and Tailwind-native, but it copies in many
  files and several Radix packages for the handful of components needed now. A reasonable choice
  if complex widgets (combobox, date picker) become necessary.
- **Headless UI:** smaller, but still a dependency for two simple widgets.
- **Google Fonts:** no dependency, but a third-party request on every page load and an extra CSP
  origin.

## Trade-offs

- We own the accessibility of the drawer and menu. Mitigated by tests (keyboard, focus return,
  `inert`, axe-core) but less battle-tested than Radix.
- Complex widgets later (date range picker, combobox for filters) will need either careful work or
  a primitive library; this ADR does not rule that out.

## Consequences

- The kit is a few hundred lines that are easy to read and change, and it matches the concept
  exactly.
- New pages compose `PageHeader`, `Card`, state components and `useApiQuery`
  (see [docs/frontend/ui-foundation.md](../frontend/ui-foundation.md)).
- If a primitive library is adopted later, it should replace the hand-written drawer and menu
  rather than sit beside them.
