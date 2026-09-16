# Mobile Optimization (Phase 1) — Design

## Goal

The DripIT Operations Console (`src/App.jsx`, React/Vite, localStorage-only,
no backend) is a fixed desktop layout: a 240px sidebar, no media queries
beyond print, and several dense grids/tables that don't fit a phone
screen. The owner wants to comfortably use the app on a phone for quick
checks and light edits — glancing at the Dashboard, checking an order's
status, marking things delivered/paid — without needing the desktop's
full data-entry surface to work perfectly on mobile yet.

This is Phase 1 of a multi-phase effort. It covers the navigation shell
and the three screens that serve the "quick checks" use case: Dashboard,
Orders list, and the order detail view. Later phases (not in this spec)
cover New Order, Books & Ledger, Sales Invoice/Receipts, Expenses, and
both Post Makers.

## Non-goals (explicitly out of scope this phase)

- New Order form, Books & Ledger, Sales Invoice, Paid Receipts, Expenses,
  Post Maker, New Post Maker, Export & Sync — desktop-only for now; they
  remain reachable via the mobile "More" sheet but are not restyled.
- Any change to the desktop (≥769px) layout or visual output. Desktop
  must render pixel-identical to today above the breakpoint.
- Any backend/server change — this is frontend-only.

## Architecture

**Breakpoint-driven, CSS-only, additive — no JS resize listeners, no
duplicated React state.**

A single breakpoint, `768px`, gates everything: viewports `≤768px`
("mobile") get the new treatment, `>768px` ("desktop") stay exactly as
today. This is expressed entirely as one new `@media (max-width: 768px)
{ ... }` block in the existing `GlobalStyles()` component (the same
component that already injects the `@media print` rules) — same
technique already proven in this codebase, just a second block.

Two new utility classes drive all shell-level visibility:

- `.desktop-only` — `display: <whatever the element already uses>` above
  768px, `display: none` at/below it.
- `.mobile-only` — the reverse: `display: none` above 768px, its normal
  `display` at/below it.

Components that need a genuinely different structure on mobile (not just
a smaller version of the same DOM) render **both** versions unconditionally
and let these two classes pick which one is visible — the same pattern
`Sidebar`/print already uses via `.no-print`. This avoids a
`useIsMobile()` hook entirely: nothing re-renders on resize, there is no
extra state, and the desktop tree is untouched by construction (its CSS
rules are simply never selected below 768px, and its markup doesn't
change at all).

Where a component's *existing* DOM already reflows reasonably (CSS Grid
`auto-fit`, `flex-wrap`, or a `width:100%; max-width:Npx` panel that
already goes full-width on a narrow viewport), no dual-render is needed —
just a padding/sizing tweak inside the existing `@media` block. Two such
cases were found during design (noted per-component below), which
meaningfully shrinks the actual amount of new markup this phase needs.

## Components touched

### 1. `GlobalStyles()`
Add the `@media (max-width: 768px)` block with:
- `.desktop-only` / `.mobile-only` rules.
- `body`/root padding reset so content isn't clipped by the phone's own
  safe-area insets.
- A `--bottom-nav-height` custom property (e.g. `62px`) so any mobile
  screen can reserve bottom padding for the nav bar without hardcoding
  the number in multiple places.

### 2. `Sidebar` → gains `.desktop-only` on its `<aside>`
No internal changes. Simply stops rendering below 768px.

### 3. New: `BottomNav` component
Rendered as a sibling of `Sidebar` inside the main `App()` shell, class
`.mobile-only`. Fixed to the viewport bottom (`position: fixed; bottom:
0; left: 0; right: 0`), five equal-width tap targets:

| Icon | Label | `view` id |
|---|---|---|
| `LayoutDashboard` | Home | `dashboard` |
| `ShoppingBag` | Orders | `orders` |
| `Plus` (accented) | New | `new` |
| `BookOpen` | Books | `books` |
| `MoreHorizontal` | More | opens `MoreSheet` (local state, not a `view`) |

Each tap target ≥48px tall (touch-target minimum). Active tab highlighted
using the existing `view === id` comparison already used in `Sidebar`.

### 4. New: `MoreSheet` component
A bottom sheet (slides up from behind `BottomNav`, `position: fixed;
inset: 0`, dimmed backdrop, sheet content anchored to the bottom, `.mobile-only`
— never mounted/visible on desktop) listing the six sections not on the
bottom bar (Sales Invoice, Paid Receipts, Expenses, Post Maker, New Post
Maker, Export & Sync), same icon+label pairs `Sidebar` already defines.
Tapping an item navigates via the existing `setView`/`pendingNavigate`
and closes the sheet. Local `open` state lives in `App()` alongside the
existing `view` state — no router involved, matching the rest of the app.

### 5. `Header`
No dual-render. `@media` tweaks only: the title/subtitle block and the
`CompanySwitcher` + date row currently sit `justify-content:
space-between` on one line (`flex-wrap` not set) — add `flex-wrap: wrap`
and drop the date string on mobile (`.desktop-only` on that one `<div>`)
since it's the least essential element and the likeliest to force a
second line awkwardly. `CompanySwitcher`'s popover already
`position: absolute` from its own trigger — add a max-width clamp so it
can't overflow the viewport edge on a narrow screen.

### 6. `Dashboard`
Two of its three layout blocks already reflow correctly and need no
markup change:
- The six `MetricCard`s already use
  `gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))'`, which
  naturally collapses to a single column under ~400px — confirmed by the
  minmax math against a phone viewport minus padding. No change.
- `Recent Orders` (`MiniOrderRow`) is already a flexible row, not a fixed
  grid, and already wraps its two text lines — no change.

One block needs an `@media` override: **Order Pipeline / Open Loans
Summary** currently sits in a hardcoded `gridTemplateColumns: '1fr 1fr'`
two-up grid — add a class (`dashboard-split`) so the media block can
override it to `grid-template-columns: 1fr` (stacked) below 768px.

Outer page padding (`main`'s `28px 36px`, see item 8) is the other lever
that makes this screen usable at all on a 375–430px viewport.

### 7. `Orders` list — dual-render
`OrderRow`'s desktop layout is a 9-column CSS grid
(`'40px 100px 1fr 1fr 110px 160px 50px 50px 40px'`) — fundamentally a
table-shaped layout, not something a media query can turn into a card
list. Per the architecture above, this gets a real second component
instead of a CSS override:

- New `OrderCardMobile({ order, ... })` — same props/callbacks `OrderRow`
  already takes (status change, open, invoice/receipt, copy), rendered as
  a stacked card: customer name + order # on one line, product name +
  date under it, a status pill, the total, and the same tap-to-open
  behavior `MiniOrderRow` already has on the Dashboard. Bulk-select
  checkbox stays, top-right corner of the card.
- `Orders`' column-header row (`Order # / Customer / Product / ...`)
  gets `.desktop-only` — a card list doesn't need it.
- The existing search/filter bar (`flexWrap: 'wrap'` already) and the New
  Order button need no structural change, only spacing tweaks inside the
  `@media` block so they don't feel cramped at 375px.
- Each `OrderRow` / `OrderCardMobile` pair is rendered together per order
  (both in the DOM, `.desktop-only` / `.mobile-only` picking one) — the
  same one-extra-row-in-the-DOM tradeoff `Sidebar`/`BottomNav` already
  makes, acceptable given order lists are tens to a few hundred rows, not
  thousands.

### 8. `OrderModal`
Already most of the way there: it's a right-side panel with
`width: '100%', maxWidth: 620`, which is already full-viewport-width on
any screen narrower than 620px — no structural change needed. `@media`
tweaks only: reduce the `20px 28px` header padding and the body padding
to something narrower (e.g. `16px`) so content isn't pressed against the
edges, and confirm the checkpoint timeline / action buttons (already
flex-based) don't need more than that. If a specific internal block is
found to overflow during the visual check (Testing, below), it gets the
same `.desktop-only`/`.mobile-only` treatment as `Orders`, but no such
block is expected going in.

### 9. `main` content area
`padding: '28px 36px', maxWidth: 'calc(100vw - 240px)'` is currently
inline on the `<main>` element in `App()`. Needs a class
(`app-main`) so the `@media` block can override both: padding down to
`16px` (matches the artifact-design side-gutter convention already used
elsewhere in this project) plus `padding-bottom:
calc(var(--bottom-nav-height) + 16px)` so content can't sit under the
fixed `BottomNav`, and `maxWidth: 'calc(100vw - 240px)'` back to `100%`
(no sidebar to subtract below 768px).

## Data flow

No changes. Every new/touched component consumes the same props and
calls the same handlers (`setView`, `onOpenOrder`, `onUpdateOrder`, etc.)
that already flow from `App()` today — mobile is a rendering concern
only, not a state or data-shape change.

## Error handling

None of this phase touches data mutation paths (order updates, payments,
ledger writes) — those are unchanged. The only new interactive surface
is `MoreSheet`'s open/close state, which is local `useState` with no
failure mode beyond "stays open/closed."

## Testing approach

No test file exists for `App.jsx` today (it's a localStorage-only
frontend with zero automated tests) — this phase doesn't introduce one.
Verification is visual, via the browser tool, following the pattern
already used throughout this project's session history:

1. `npm run build` (PowerShell) must succeed with no errors.
2. Serve via `npm run dev`, open in the browser tool at a phone viewport
   (375×812, matching a common iPhone size) and check each Phase-1
   screen: Dashboard, Orders (with several real orders visible), an
   opened `OrderModal`, the `BottomNav`, and `MoreSheet`.
3. Re-check the same screens at a desktop width (e.g. 1440×900) and
   confirm they are visually unchanged from before this work — this is
   the hard requirement from the design conversation ("desktop
   unchanged, mobile is additive").
4. Check one in-between width (e.g. 800×1024, an iPad-ish size) to
   confirm the 768px breakpoint doesn't land awkwardly for anyone on a
   tablet — no specific tablet design is required, just "not broken."

## Open questions

None outstanding — the two rounds of clarifying questions in the
brainstorming conversation (primary use case, navigation pattern,
phasing, desktop-preservation constraint) resolved every design decision
needed to implement this phase.
