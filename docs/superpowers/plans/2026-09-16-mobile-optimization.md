# Mobile Optimization (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the DripIT Operations Console (`src/App.jsx`) usable on a phone for the "quick checks + light edits" use case — Dashboard, Orders list, and order detail — via a CSS-only, additive mobile layout that leaves the desktop layout completely untouched.

**Architecture:** A single `@media (max-width: 768px)` block added to the existing `GlobalStyles()` component drives everything. Two utility classes, `.desktop-only` and `.mobile-only`, toggle which markup is visible; components with a fundamentally different mobile layout (the Orders list) render both versions unconditionally and let CSS pick one — no `useIsMobile()` hook, no resize listeners, no duplicated React state. Components that already reflow reasonably (Dashboard's metric-card grid, the order detail modal) get padding/sizing tweaks only.

**Tech Stack:** React 18 (function components, hooks), Vite, no CSS framework — all styling is inline `style={{}}` objects plus a handful of utility classes injected via one `<style>` tag in `GlobalStyles()`. `lucide-react` for icons. No test runner is configured for this frontend (localStorage-only, no existing test file) — verification in this plan is build-success + visual checks via the browser tool, per the spec's Testing Approach section.

**Spec:** `docs/superpowers/specs/2026-09-16-mobile-optimization-design.md`

## Global Constraints

- Breakpoint is exactly `768px` (`@media (max-width: 768px)`). Viewports `>768px` must render identically to before this plan — every mobile-specific rule lives inside that one media block, and every mobile-specific inline change is either purely additive/inert at desktop widths (documented per-task where used) or gated by a class that only takes effect inside that block.
- No JS resize listeners, no new global state for "is mobile" — CSS media queries only.
- Only these files change: `src/App.jsx`. No backend/server files, no new dependencies (`lucide-react`'s `MoreHorizontal` icon is already available in the installed package, just not yet imported).
- This frontend has no test suite. Each task's verification step is: `npm run build` (PowerShell — the Bash tool's `npm` is broken in this environment) succeeds, then a visual check via the browser tool at the stated viewport size(s).
- Every new interactive element (BottomNav tabs, More sheet items) must go through the existing `handleNavRequest` function (passed into `Sidebar` today as its `setView` prop) rather than calling `setView` directly, so the "unsaved Post Maker project" navigation guard already in `App()` keeps working from the new mobile nav too.
- Reuse existing theme tokens (`T.*`), `STATUS`, `fmtBDT`/`fmtDate`, and the `.pcg-btn`/`.pcg-btn-ghost` classes already defined — don't introduce a second color palette or button style for mobile.

---

### Task 1: Responsive shell infrastructure — hide sidebar, full-width content on mobile

**Files:**
- Modify: `src/App.jsx:994-1048` (`GlobalStyles`)
- Modify: `src/App.jsx:1068` (`Sidebar`'s `<aside>` className)
- Modify: `src/App.jsx:948` (`main` element in `App()`)

**Interfaces:**
- Produces: CSS classes `.desktop-only`, `.mobile-only`, `.app-main` (all defined inside the new `@media (max-width: 768px)` block in `GlobalStyles()`), and the CSS custom property `--bottom-nav-height: 62px`. Every later task in this plan appends its own rule(s) into this same media block and/or uses these classes — do not create a second `@media (max-width: 768px)` block elsewhere in the file.

- [ ] **Step 1: Add the mobile media block to `GlobalStyles()`**

Open `src/App.jsx` and find the end of the `@media print` block inside `GlobalStyles()` (around line 1045, the line reading `      }` right before the closing `` `}</style> ``). Insert a new block immediately after the `@media print { ... }` block's closing brace and before the closing `` `}</style> ``:

```javascript
      @media (max-width: 768px) {
        :root { --bottom-nav-height: 62px; }
        .desktop-only { display: none !important; }
        .mobile-only { display: block; }
        .app-main {
          padding: 16px !important;
          max-width: 100% !important;
          padding-bottom: calc(var(--bottom-nav-height) + 16px) !important;
        }
      }
```

The full end of the template string should now read:

```javascript
      @media print {
        body * { visibility: hidden; }
        .print-area, .print-area * { visibility: visible; }
        .print-area { position: absolute; left: 0; top: 0; width: 210mm; padding: 15mm 18mm; }
        .no-print { display: none !important; }
        @page { size: A4 portrait; margin: 12mm 15mm; }
      }
      @media (max-width: 768px) {
        :root { --bottom-nav-height: 62px; }
        .desktop-only { display: none !important; }
        .mobile-only { display: block; }
        .app-main {
          padding: 16px !important;
          max-width: 100% !important;
          padding-bottom: calc(var(--bottom-nav-height) + 16px) !important;
        }
      }
    `}</style>
  );
}
```

Note: `.mobile-only` defaults to `display: block`. A later task (Task 2) needs `.bottom-nav` to be a flex row, not a block — that's handled by giving the `<nav>` element BOTH classes (`className="mobile-only bottom-nav"`) and defining `.bottom-nav { display: flex; ... }` with higher specificity via the class combination (two classes on one element — `display:flex` from `.bottom-nav` wins over `.mobile-only`'s `display:block` because it's a separate rule targeting the same specificity; browsers resolve same-specificity conflicts by source order, and `.bottom-nav`'s rule will be added after `.mobile-only`'s by every later task in this plan, so it wins). This is called out again in Task 2 where it matters.

- [ ] **Step 2: Mark the desktop sidebar `.desktop-only`**

In `Sidebar` (around line 1068), find:

```javascript
    <aside className="no-print" style={{ width: 240, background: T.surface, borderRight: `1px solid ${T.borderSoft}`, padding: '24px 14px', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
```

Change the `className` to include the new class:

```javascript
    <aside className="no-print desktop-only" style={{ width: 240, background: T.surface, borderRight: `1px solid ${T.borderSoft}`, padding: '24px 14px', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
```

- [ ] **Step 3: Give `main` the `.app-main` class**

In `App()` (around line 948), find:

```javascript
        <main style={{ flex: 1, padding: '28px 36px', maxWidth: 'calc(100vw - 240px)' }}>
```

Change to:

```javascript
        <main className="app-main" style={{ flex: 1, padding: '28px 36px', maxWidth: 'calc(100vw - 240px)' }}>
```

(The inline `style` values are the desktop values and stay exactly as they are — `.app-main`'s `@media` rule overrides them with `!important` only below 768px. This is why `!important` is used in Step 1: to win over the higher-specificity inline `style` attribute, but only inside the media query, so desktop is unaffected.)

- [ ] **Step 4: Build**

Run in PowerShell: `npm run build`
Expected: builds with no errors (this task adds no new component, so no new import/reference risk — a failure here means a typo in the edits above).

- [ ] **Step 5: Visual check**

Run `npm run dev` (PowerShell, background), open the app in the browser tool.
- At a 1440×900 viewport: confirm the sidebar is visible and the layout is unchanged from before this task.
- At a 375×812 viewport (phone): confirm the sidebar is now gone and the main content area fills the full width with visibly smaller side padding. There is no navigation yet at this width (that's Task 2) — this is expected and fine for this task's scope.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "app: mobile shell infra — hide sidebar, full-width content below 768px"
```

---

### Task 2: Bottom navigation + More sheet

**Files:**
- Modify: `src/App.jsx:2-9` (icon imports)
- Modify: `src/App.jsx:1053-1066` (extract `Sidebar`'s `items` array to a shared module-level constant)
- Modify: `src/App.jsx:994-1048` area (append CSS rules to the existing mobile media block from Task 1)
- Create (as new functions in the same file, placed directly after `Sidebar`'s closing brace, i.e. after line 1093): `BottomNav`, `MoreSheet`
- Modify: `src/App.jsx` (`App()`'s render, around line 946-947) — add state and render the two new components

**Interfaces:**
- Consumes: `.desktop-only`/`.mobile-only` classes and `--bottom-nav-height` from Task 1. `handleNavRequest` (already defined in `App()` at line 914, unchanged).
- Produces: module-level `const NAV_ITEMS = [...]` (the 10 `{id, label, icon}` entries, same shape `Sidebar` already builds locally), `const BOTTOM_NAV_IDS = ['dashboard', 'orders', 'new', 'books']`, components `BottomNav({ view, setView, onMore })` and `MoreSheet({ open, onClose, view, setView })`. Later tasks don't consume these directly, but any future phase adding an 11th section should add it to `NAV_ITEMS` once, not to two separate lists.

- [ ] **Step 1: Import the `MoreHorizontal` icon**

In the `lucide-react` import block (lines 2-9), add `MoreHorizontal` to the list. Find:

```javascript
  Banknote, Landmark, ArrowLeftRight, Pencil, Save, Eye, Upload, ImagePlus
} from 'lucide-react';
```

Change to:

```javascript
  Banknote, Landmark, ArrowLeftRight, Pencil, Save, Eye, Upload, ImagePlus, MoreHorizontal
} from 'lucide-react';
```

- [ ] **Step 2: Extract `NAV_ITEMS` as a shared constant**

Find `Sidebar`'s local `items` array (lines 1054-1065):

```javascript
function Sidebar({ view, setView, pendingNavigate, onConfirmNavigate, onCancelNavigate }) {
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'orders', label: 'Orders', icon: ShoppingBag },
    { id: 'new', label: 'New Order', icon: Plus },
    { id: 'invoices', label: 'Sales Invoice', icon: FileText },
    { id: 'receipts', label: 'Paid Receipts', icon: CheckCircle2 },
    { id: 'expenses', label: 'Expenses', icon: Receipt },
    { id: 'books', label: 'Books & Ledger', icon: BookOpen },
    { id: 'postmaker', label: 'Post Maker', icon: QrCode },
    { id: 'newpostmaker', label: 'New Post Maker', icon: ImagePlus },
    { id: 'export', label: 'Export & Sync', icon: FileSpreadsheet }
  ];

  return (
```

Replace with (moves the array out as a module-level constant right before `Sidebar`, and has `Sidebar` reference it):

```javascript
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'orders', label: 'Orders', icon: ShoppingBag },
  { id: 'new', label: 'New Order', icon: Plus },
  { id: 'invoices', label: 'Sales Invoice', icon: FileText },
  { id: 'receipts', label: 'Paid Receipts', icon: CheckCircle2 },
  { id: 'expenses', label: 'Expenses', icon: Receipt },
  { id: 'books', label: 'Books & Ledger', icon: BookOpen },
  { id: 'postmaker', label: 'Post Maker', icon: QrCode },
  { id: 'newpostmaker', label: 'New Post Maker', icon: ImagePlus },
  { id: 'export', label: 'Export & Sync', icon: FileSpreadsheet }
];

// Bottom nav shows these 4; everything else in NAV_ITEMS lives in the
// "More" sheet. Keep this list in sync if NAV_ITEMS' most-used items change.
const BOTTOM_NAV_IDS = ['dashboard', 'orders', 'new', 'books'];

function Sidebar({ view, setView, pendingNavigate, onConfirmNavigate, onCancelNavigate }) {
  const items = NAV_ITEMS;

  return (
```

- [ ] **Step 3: Append bottom-nav and more-sheet CSS to the mobile media block**

In the `@media (max-width: 768px)` block added in Task 1, add these rules after `.app-main { ... }` and before the block's closing `}`:

```javascript
        .bottom-nav {
          display: flex; position: fixed; left: 0; right: 0; bottom: 0;
          background: ${T.surface}; border-top: 1px solid ${T.borderSoft};
          height: var(--bottom-nav-height); z-index: 60;
          padding-bottom: env(safe-area-inset-bottom, 0);
        }
        .bottom-nav-btn {
          flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 2px; background: none; border: none; font-size: 10px; font-weight: 500;
          font-family: ${T.sans}; cursor: pointer; padding: 6px 0;
        }
        .more-sheet-backdrop {
          position: fixed; inset: 0; background: rgba(15,15,15,0.45); z-index: 70;
          display: flex; align-items: flex-end;
        }
        .more-sheet {
          background: ${T.surface}; width: 100%; border-radius: 16px 16px 0 0;
          padding: 10px 14px calc(var(--bottom-nav-height) + 14px);
          max-height: 70vh; overflow-y: auto;
        }
        .more-sheet-handle { width: 36px; height: 4px; background: ${T.border}; border-radius: 2px; margin: 6px auto 14px; }
        .more-sheet-item {
          display: flex; align-items: center; gap: 12px; width: 100%; padding: 13px 12px;
          border: none; border-radius: 10px; font-size: 14px; cursor: pointer; text-align: left;
          margin-bottom: 2px; font-family: ${T.sans};
        }
```

(This whole block is still inside `@media (max-width: 768px)`, so none of it applies at desktop widths regardless of whether the elements exist in the DOM there.)

- [ ] **Step 4: Add the `BottomNav` and `MoreSheet` components**

Immediately after `Sidebar`'s closing `}` (after line 1093, before the blank lines leading into `function Header`), add:

```javascript
function BottomNav({ view, setView, onMore }) {
  const items = BOTTOM_NAV_IDS.map(id => NAV_ITEMS.find(i => i.id === id));
  return (
    <nav className="mobile-only bottom-nav">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setView(id)}
          className="bottom-nav-btn"
          style={{ color: view === id ? T.terracotta : T.muted }}
        >
          <Icon size={20} strokeWidth={view === id ? 2.25 : 1.75} />
          <span>{id === 'new' ? 'New' : label}</span>
        </button>
      ))}
      <button onClick={onMore} className="bottom-nav-btn" style={{ color: T.muted }}>
        <MoreHorizontal size={20} strokeWidth={1.75} />
        <span>More</span>
      </button>
    </nav>
  );
}

function MoreSheet({ open, onClose, view, setView }) {
  if (!open) return null;
  const items = NAV_ITEMS.filter(i => !BOTTOM_NAV_IDS.includes(i.id));
  return (
    <div className="mobile-only more-sheet-backdrop" onClick={onClose}>
      <div className="more-sheet" onClick={e => e.stopPropagation()}>
        <div className="more-sheet-handle" />
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { setView(id); onClose(); }}
            className="more-sheet-item"
            style={{ color: view === id ? T.ink : T.muted, background: view === id ? T.cream : 'transparent' }}
          >
            <Icon size={17} strokeWidth={1.75} /> {label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire both into `App()`**

Find the "Navigation guard for PostMaker" state block (around line 912-913):

```javascript
  const [pendingNav, setPendingNav] = useState(null);
  const [showNavGuard, setShowNavGuard] = useState(false);
```

Add a new state line right after it:

```javascript
  const [pendingNav, setPendingNav] = useState(null);
  const [showNavGuard, setShowNavGuard] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
```

Then find the shell render (around line 946-948):

```javascript
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar view={view} setView={handleNavRequest} />
        <main className="app-main" style={{ flex: 1, padding: '28px 36px', maxWidth: 'calc(100vw - 240px)' }}>
```

Change to:

```javascript
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar view={view} setView={handleNavRequest} />
        <BottomNav view={view} setView={handleNavRequest} onMore={() => setMoreOpen(true)} />
        <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} view={view} setView={handleNavRequest} />
        <main className="app-main" style={{ flex: 1, padding: '28px 36px', maxWidth: 'calc(100vw - 240px)' }}>
```

- [ ] **Step 6: Build**

Run in PowerShell: `npm run build`
Expected: builds with no errors. A common mistake here is forgetting the `MoreHorizontal` import (Step 1) — if the build error mentions `MoreHorizontal is not defined`, re-check Step 1.

- [ ] **Step 7: Visual check**

`npm run dev`, browser tool at 375×812:
- Confirm a 5-tab bar is fixed to the bottom: Home, Orders, New, Books, More.
- Tap each of the 4 direct tabs — confirm the page content changes and the tapped tab highlights (terracotta color, bolder icon).
- Tap "More" — confirm a sheet slides up from the bottom listing the other 6 sections (Sales Invoice, Paid Receipts, Expenses, Post Maker, New Post Maker, Export & Sync). Tap one — confirm it navigates and the sheet closes. Tap the backdrop with the sheet open — confirm it closes without navigating.
- At 1440×900: confirm no bottom bar is visible and nothing about the desktop layout changed from Task 1.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "app: add mobile bottom navigation + More sheet"
```

---

### Task 3: Header mobile reflow

**Files:**
- Modify: `src/App.jsx:1111-1121` (`Header`)
- Modify: `src/App.jsx:1142-1146` (`CompanySwitcher`'s popover)
- Modify: mobile media block in `GlobalStyles()` (append one rule)

**Interfaces:**
- Consumes: `.desktop-only` from Task 1.

- [ ] **Step 1: Add a `page-header` class and hide the date on mobile**

Find `Header`'s return (lines 1111-1121):

```javascript
  return (
    <header className="no-print" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', borderBottom: `1px solid ${T.borderSoft}`, paddingBottom: 18 }}>
      <div>
        <h1 style={{ fontFamily: T.serif, fontSize: 32, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: T.ink }}>{t.title}</h1>
        <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>{t.sub}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <CompanySwitcher current={currentCompany} setCurrent={setCurrentCompany} />
        <div style={{ fontSize: 12, color: T.muted, fontVariantNumeric: 'tabular-nums' }}>{new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
      </div>
    </header>
  );
```

Replace with:

```javascript
  return (
    <header className="no-print page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', borderBottom: `1px solid ${T.borderSoft}`, paddingBottom: 18 }}>
      <div>
        <h1 style={{ fontFamily: T.serif, fontSize: 32, fontWeight: 500, letterSpacing: '-0.02em', margin: 0, color: T.ink }}>{t.title}</h1>
        <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>{t.sub}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <CompanySwitcher current={currentCompany} setCurrent={setCurrentCompany} />
        <div className="desktop-only" style={{ fontSize: 12, color: T.muted, fontVariantNumeric: 'tabular-nums' }}>{new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
      </div>
    </header>
  );
```

- [ ] **Step 2: Clamp the company-switcher popover width**

Find (around line 1142-1146):

```javascript
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
            boxShadow: '0 10px 40px rgba(0,0,0,0.1)', minWidth: 220, zIndex: 50, overflow: 'hidden'
          }}>
```

Change to (adds `maxWidth`, inert on desktop since `calc(100vw - 28px)` is always far larger than the popover's natural width there):

```javascript
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
            boxShadow: '0 10px 40px rgba(0,0,0,0.1)', minWidth: 220, maxWidth: 'calc(100vw - 28px)', zIndex: 50, overflow: 'hidden'
          }}>
```

- [ ] **Step 3: Add the wrap rule to the mobile media block**

Append to the same `@media (max-width: 768px)` block:

```javascript
        .page-header { flex-wrap: wrap; gap: 10px; }
```

- [ ] **Step 4: Build**

Run in PowerShell: `npm run build`
Expected: no errors.

- [ ] **Step 5: Visual check**

`npm run dev`, browser tool at 375×812 on the Dashboard: confirm the title/subtitle and the company switcher no longer fight for space or clip — the date string should not appear at all on mobile. Open the company switcher — confirm its dropdown stays fully within the screen width. At 1440×900: confirm the header (including the date) looks exactly as before Task 1.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "app: reflow header for mobile — hide date, wrap, clamp popover width"
```

---

### Task 4: Dashboard mobile stacking

**Files:**
- Modify: `src/App.jsx:1194` (`Dashboard`'s Order Pipeline / Open Loans Summary grid)
- Modify: mobile media block in `GlobalStyles()` (append one rule)

**Interfaces:**
- Consumes: Task 1's mobile media block.

- [ ] **Step 1: Add a `dashboard-split` class**

Find (line 1194):

```javascript
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
```

Change to:

```javascript
      <div className="dashboard-split" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
```

- [ ] **Step 2: Append the stacking rule**

Append to the mobile media block:

```javascript
        .dashboard-split { grid-template-columns: 1fr !important; }
```

- [ ] **Step 3: Build**

Run in PowerShell: `npm run build`
Expected: no errors.

- [ ] **Step 4: Visual check**

`npm run dev`, browser tool, Dashboard at 375×812: confirm the six metric cards already read as a single column (this was already true before this task — Task 4 doesn't change it, just confirm it's still correct), and confirm "Order Pipeline" and "Open Loans Summary" now stack vertically instead of squeezing side-by-side. At 1440×900: confirm the two-column layout is unchanged from before.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "app: stack Dashboard's Order Pipeline / Open Loans panels on mobile"
```

---

### Task 5: Orders list — mobile card view

**Files:**
- Modify: `src/App.jsx:1390` (`Orders`' column header row)
- Modify: `src/App.jsx:1403-1418` (`Orders`' row-rendering loop)
- Modify: `src/App.jsx:1450-1451` (`OrderRow`'s root element — add `desktop-only`)
- Create (as a new function, placed directly after `OrderRow`'s closing brace, i.e. after line 1553): `OrderCardMobile`

**Interfaces:**
- Consumes: `STATUS`, `calcOrder`, `fmtBDT`, `fmtDate`, `messages` (all already module-level in this file, same ones `OrderRow` uses), `.desktop-only`/`.mobile-only` from Task 1.
- Produces: `OrderCardMobile({ order, invoices, ledger, company, isSelected, onToggleSelect, onStatusChange, onShowInvoice, onShowReceipt, onOpen, copyText })` — same prop names/types as `OrderRow`, so it's a drop-in second renderer for the same `order` data, not a new data shape.

- [ ] **Step 1: Hide the desktop column-header row on mobile**

Find (line 1390):

```javascript
            <div style={{ display: 'grid', gridTemplateColumns: '40px 100px 1fr 1fr 110px 160px 50px 50px 40px', padding: '12px 16px', borderBottom: `1px solid ${T.borderSoft}`, fontSize: 10.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, alignItems: 'center', gap: 8 }}>
```

Change to:

```javascript
            <div className="desktop-only" style={{ display: 'grid', gridTemplateColumns: '40px 100px 1fr 1fr 110px 160px 50px 50px 40px', padding: '12px 16px', borderBottom: `1px solid ${T.borderSoft}`, fontSize: 10.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, alignItems: 'center', gap: 8 }}>
```

- [ ] **Step 2: Mark `OrderRow`'s root `desktop-only`**

Find `OrderRow`'s return (line 1450-1451):

```javascript
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '40px 100px 1fr 1fr 110px 160px 50px 50px 40px', padding: '14px 16px', borderBottom: `1px solid ${T.borderSoft}`, alignItems: 'center', fontSize: 13.5, gap: 8, position: 'relative', background: isSelected ? T.terracotta + '08' : 'transparent' }}>
```

Change to:

```javascript
  return (
    <div className="desktop-only" style={{ display: 'grid', gridTemplateColumns: '40px 100px 1fr 1fr 110px 160px 50px 50px 40px', padding: '14px 16px', borderBottom: `1px solid ${T.borderSoft}`, alignItems: 'center', fontSize: 13.5, gap: 8, position: 'relative', background: isSelected ? T.terracotta + '08' : 'transparent' }}>
```

(`OrderRow` is used in exactly one place in this file — the loop touched in Step 3 — so hardcoding this class directly is safe and doesn't need a prop.)

- [ ] **Step 3: Render `OrderCardMobile` alongside `OrderRow`**

Find the rendering loop (lines 1403-1418):

```javascript
            {filtered.map(o => (
              <OrderRow
                key={o.id}
                order={o}
                invoices={invoices}
                ledger={ledger}
                company={company}
                isSelected={selected.has(o.id)}
                onToggleSelect={() => toggleSelect(o.id)}
                onStatusChange={(newStatus) => applyStatusToOrder(o, newStatus)}
                onShowInvoice={onShowInvoice}
                onShowReceipt={onShowReceipt}
                onOpen={() => onOpenOrder(o)}
                copyText={copyText}
              />
            ))}
```

Change to (same props, now rendered twice per order — `OrderRow` is `.desktop-only`, `OrderCardMobile` is `.mobile-only`, so only one is ever visible at once):

```javascript
            {filtered.map(o => (
              <React.Fragment key={o.id}>
                <OrderRow
                  order={o}
                  invoices={invoices}
                  ledger={ledger}
                  company={company}
                  isSelected={selected.has(o.id)}
                  onToggleSelect={() => toggleSelect(o.id)}
                  onStatusChange={(newStatus) => applyStatusToOrder(o, newStatus)}
                  onShowInvoice={onShowInvoice}
                  onShowReceipt={onShowReceipt}
                  onOpen={() => onOpenOrder(o)}
                  copyText={copyText}
                />
                <OrderCardMobile
                  order={o}
                  invoices={invoices}
                  ledger={ledger}
                  company={company}
                  isSelected={selected.has(o.id)}
                  onToggleSelect={() => toggleSelect(o.id)}
                  onStatusChange={(newStatus) => applyStatusToOrder(o, newStatus)}
                  onShowInvoice={onShowInvoice}
                  onShowReceipt={onShowReceipt}
                  onOpen={() => onOpenOrder(o)}
                  copyText={copyText}
                />
              </React.Fragment>
            ))}
```

- [ ] **Step 4: Add `OrderCardMobile`**

Immediately after `OrderRow`'s closing `}` (after line 1553, before the `NEW ORDER` section comment banner), add:

```javascript
// A stacked-card rendering of the same order data OrderRow shows as a
// table row — OrderRow's 9-column grid can't be reflowed into a card via
// CSS alone, so this is a real second component rather than a media
// query. The message/doc dropdown logic below intentionally mirrors
// OrderRow's rather than sharing a hook with it: mobile may want a
// different interaction there in a later phase (e.g. a full sheet
// instead of a small anchored dropdown), so keeping them separate now
// avoids coupling that would make that change harder later.
function OrderCardMobile({ order, invoices, ledger, company, isSelected, onToggleSelect, onStatusChange, onShowInvoice, onShowReceipt, onOpen, copyText }) {
  const c = calcOrder(order);
  const s = STATUS[order.status];
  const linkedInvoice = (invoices || []).find(inv => inv.relatedOrderId === order.id);
  const linkedPayments = (ledger || []).filter(l => l.relatedOrderId === order.id && l.direction === 'in' && l.kind !== 'cogs');

  const [msgOpen, setMsgOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);

  const messageOptions = [
    { id: 'advance', label: 'Advance Payment Request', available: !order.skipAdvance },
    { id: 'confirmed', label: 'Order Confirmation', available: order.orderPlacedMY || order.skipAdvance },
    { id: 'reachedBD', label: 'Reached Bangladesh', available: order.reachedBD },
    { id: 'outForDelivery', label: 'Out for Delivery', available: order.onTheWay },
    { id: 'delivered', label: 'Delivery Confirmation', available: order.delivered }
  ];

  const handleCopyMessage = (type) => {
    const text = messages[type] ? messages[type](order, company) : '';
    copyText(text, 'Message copied — paste in Messenger');
    setMsgOpen(false);
  };

  return (
    <div className="mobile-only" style={{ padding: '14px 16px', borderBottom: `1px solid ${T.borderSoft}`, background: isSelected ? T.terracotta + '08' : 'transparent' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <input type="checkbox" checked={isSelected} onChange={onToggleSelect} style={{ cursor: 'pointer', accentColor: T.terracotta, marginTop: 3 }} />
        <div onClick={onOpen} style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <div style={{ color: T.ink, fontWeight: 500, fontSize: 14 }}>{order.customerName}</div>
            <div style={{ fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 15, flexShrink: 0 }}>{fmtBDT(c.selling)}</div>
          </div>
          <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{order.orderNumber} · {order.customerPhone}</div>
          <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.productName}</div>
          <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{fmtDate(order.orderDate)}</div>
        </div>
        <ChevronRight size={15} color={T.muted} style={{ marginTop: 4, flexShrink: 0 }} onClick={onOpen} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, marginLeft: 26 }} onClick={e => e.stopPropagation()}>
        <select
          value={order.status}
          onChange={e => onStatusChange(e.target.value)}
          style={{
            flex: 1, padding: '6px 8px', fontSize: 11.5, fontWeight: 700,
            background: s.bg, color: s.color, border: `1.5px solid ${s.color}40`,
            borderRadius: 6, cursor: 'pointer', appearance: 'menulist', letterSpacing: '0.02em'
          }}
        >
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k} style={{ background: T.surface, color: T.ink }}>{v.label}</option>)}
        </select>

        <div style={{ position: 'relative' }}>
          <button onClick={() => { setMsgOpen(!msgOpen); setDocOpen(false); }} className="pcg-btn pcg-btn-ghost" title="Copy message" style={{ padding: 6 }}>
            <MessageSquare size={16} />
          </button>
          {msgOpen && (
            <>
              <div onClick={() => setMsgOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', minWidth: 220, maxWidth: 'calc(100vw - 60px)', zIndex: 50, overflow: 'hidden' }}>
                {messageOptions.map(m => (
                  <button
                    key={m.id}
                    disabled={!m.available}
                    onClick={() => m.available && handleCopyMessage(m.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 12px',
                      background: 'transparent', border: 'none', cursor: m.available ? 'pointer' : 'not-allowed',
                      textAlign: 'left', fontSize: 12.5, color: m.available ? T.ink : T.muted,
                      borderBottom: `1px solid ${T.borderSoft}`
                    }}
                    title={m.available ? '' : 'Available once order reaches that stage'}
                  >
                    <Copy size={11} /> {m.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button onClick={() => { setDocOpen(!docOpen); setMsgOpen(false); }} className="pcg-btn pcg-btn-ghost" title="Print invoice or receipt" style={{ padding: 6 }}>
            <FileText size={16} />
          </button>
          {docOpen && (
            <>
              <div onClick={() => setDocOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', minWidth: 220, maxWidth: 'calc(100vw - 60px)', zIndex: 50, overflow: 'hidden' }}>
                <button
                  onClick={() => { if (linkedInvoice) { onShowInvoice(linkedInvoice); setDocOpen(false); } }}
                  disabled={!linkedInvoice}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 12px',
                    background: 'transparent', border: 'none', cursor: linkedInvoice ? 'pointer' : 'not-allowed',
                    textAlign: 'left', fontSize: 12.5, color: linkedInvoice ? T.ink : T.muted,
                    borderBottom: `1px solid ${T.borderSoft}`
                  }}
                >
                  <FileText size={12} /> Sales Invoice
                </button>
                <button
                  onClick={() => { if (order.delivered) { onShowReceipt({ order, payments: linkedPayments, company }); setDocOpen(false); } }}
                  disabled={!order.delivered}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 12px',
                    background: 'transparent', border: 'none', cursor: order.delivered ? 'pointer' : 'not-allowed',
                    textAlign: 'left', fontSize: 12.5, color: order.delivered ? T.ink : T.muted
                  }}
                  title={order.delivered ? '' : 'Available once delivered'}
                >
                  <Check size={12} /> Paid Receipt
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build**

Run in PowerShell: `npm run build`
Expected: no errors.

- [ ] **Step 6: Visual check**

`npm run dev`, browser tool, Orders view:
- At 375×812, with real order data present: confirm orders render as stacked cards (name + price on top, order#/phone, product, date, status pill + message/doc icons below), not as a squeezed table. Tap a card (not on the checkbox/status/icons) — confirm the order detail panel opens. Change the status dropdown on a card — confirm it updates. Open the message dropdown on a card — confirm it stays within the screen edges and copying a message works (check for the toast).
- At 1440×900: confirm the Orders table looks exactly as it did before this task (column header row, `OrderRow`s) — the mobile cards must not be visible or affect layout at this width.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx
git commit -m "app: add OrderCardMobile — card-based Orders list on mobile"
```

---

### Task 6: Order detail modal padding

**Files:**
- Modify: `src/App.jsx:2059` (`OrderModal` header wrapper)
- Modify: `src/App.jsx:2087` (`OrderModal` body wrapper)
- Modify: mobile media block in `GlobalStyles()` (append two rules)

**Interfaces:**
- Consumes: Task 1's mobile media block.

- [ ] **Step 1: Add classes to the header and body wrappers**

Find (line 2059):

```javascript
        <div style={{ padding: '20px 28px', borderBottom: `1px solid ${T.border}`, background: T.surface, position: 'sticky', top: 0, zIndex: 10 }}>
```

Change to:

```javascript
        <div className="order-modal-header" style={{ padding: '20px 28px', borderBottom: `1px solid ${T.border}`, background: T.surface, position: 'sticky', top: 0, zIndex: 10 }}>
```

Find (line 2087):

```javascript
        <div style={{ padding: '22px 28px' }}>
```

Change to:

```javascript
        <div className="order-modal-body" style={{ padding: '22px 28px' }}>
```

- [ ] **Step 2: Append the padding overrides**

Append to the mobile media block:

```javascript
        .order-modal-header { padding: 14px 16px !important; }
        .order-modal-body { padding: 16px !important; }
```

- [ ] **Step 3: Build**

Run in PowerShell: `npm run build`
Expected: no errors.

- [ ] **Step 4: Visual check**

`npm run dev`, browser tool, open an order's detail panel at 375×812: confirm it fills the screen width (it already did before this task, since it's `width: 100%` with a `maxWidth`), and confirm the header and body content now sit closer to the edges (14-16px) rather than the desktop's wider 20-28px, with nothing clipped. Check the checkpoint timeline and action buttons still look reasonable. At 1440×900: confirm the panel's padding is unchanged from before this task.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "app: tighten OrderModal padding on mobile"
```

---

### Task 7: Final cross-check

**Files:** None (verification only — no code changes expected; if this step surfaces a real issue, fix it in the relevant file and note the fix before committing).

**Interfaces:** None — this task validates the combined output of Tasks 1-6 against the spec's Testing Approach section.

- [ ] **Step 1: Build**

Run in PowerShell: `npm run build`
Expected: no errors.

- [ ] **Step 2: Full mobile walkthrough at 375×812**

`npm run dev`, browser tool:
- Dashboard: metric cards single-column, Pipeline/Loans stacked, Recent Orders readable, header doesn't clip, bottom nav present with Home highlighted.
- Orders: card list, search/filter bar usable, tap into an order.
- Order detail: full-width panel, comfortable padding, close it.
- Tap "New" in the bottom nav, then "Books" — confirm both navigate (their screens are out of Phase 1 scope and may still look desktop-shaped — that's expected; only confirm navigation itself works and nothing is visibly broken/overlapping at the shell level).
- Tap "More" — open one of the 6 sheet items — confirm it navigates and the sheet closes.

- [ ] **Step 3: Desktop regression check at 1440×900**

Visit Dashboard, Orders (with an order open), and the More-sheet-only screens (Sales Invoice, Expenses, etc. — just to confirm they still render at all). Compare against how they looked before this plan started (main visual anchors: sidebar present and 240px, header with date visible, Orders as a table, two-column Dashboard panels). Confirm nothing changed.

- [ ] **Step 4: Tablet sanity check at 800×1024**

Visit Dashboard and Orders. Confirm the layout is in one state or the other (mobile or desktop) without anything visibly half-broken — no specific tablet design is required per the spec, just confirm the 768px cutoff doesn't land mid-layout.

- [ ] **Step 5: Commit (only if Step 2-4 required a fix)**

If everything in Steps 2-4 matched expectations, no commit is needed for this task — Task 6's commit is the last one. If a fix was needed, commit it with a message describing exactly what was broken and how it was fixed.
