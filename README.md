# DripIT — PreOrder Console

A single-page web app for running a Malaysia → Bangladesh preorder / resale business end‑to‑end: taking orders, tracking them from payment to delivery, sending customers ready‑made WhatsApp updates, printing invoices and receipts, keeping the books (cash, bank, bKash, loans), making sale posts for social media, and exporting/backing up everything — all from one dashboard, for one or more company brands.

Built with **React 18** + **Vite**, styled inline (no CSS framework), icons from **lucide-react**. No backend is required — it runs entirely in the browser and saves data locally, with an optional free Google Sheets sync for backup/multi-device use.

---

## What it's for

The app models a specific workflow: a seller buys products in Malaysia (priced in **RM**), resells them in Bangladesh (priced in **BDT**) at a markup, collects a partial advance payment up front, and the customer pays the rest on delivery. The app tracks every order through that pipeline, keeps a simple set of company books, and automates the repetitive parts (price calculation, WhatsApp messages, invoices, receipts, exports).

It supports **two company brands** (`drip_ittt` and `NOVUS` by default, configurable in code) with a switcher in the header — each brand's orders, invoices, expenses, ledger, loans and accounts are tracked separately.

---

## Features

### 📊 Dashboard
- Key metrics at a glance: total revenue, COGS (cost of goods sold for delivered orders), net profit, bank balance (per currency), total payables, total receivables.
- **Order Pipeline** widget — live counts and percentage breakdown of orders at each status.
- **Open Loans Summary** — quick view of outstanding payables/receivables from loans.
- **Recent Orders** list with one-click access to any order.

### 🛍️ Orders
- Searchable, filterable order list with status badges.
- Click any order to open a detail modal showing the full timeline, pricing breakdown, and payment status.
- Bulk-select orders; copy WhatsApp message text or print invoice/receipt directly from the row.
- **Order status pipeline** (each step optionally triggers a ready-made customer message):
  1. **Pending** — order created, awaiting advance payment
  2. **Advance Paid**
  3. **Order Confirmed** — order placed with the supplier in Malaysia
  4. **Reached Bangladesh**
  5. **On the Way** — out for delivery
  6. **Delivered**
  7. **Cancelled** (terminal state, available at any point)
- Record partial/final payments against an order, against a specific account (cash/bank/bKash), with automatic ledger entries.
- Remove a mistaken payment record.

### ➕ New Order
- Multi-item orders — add as many products as needed to one order.
- Two pricing modes per item:
  - **Multiplier** — selling price = cost (RM) × multiplier (default 50×, overridable per item or per order).
  - **Fixed** — type the selling price (BDT) directly.
- Order-level **discounts**: none, percentage, or fixed amount.
- Automatic calculation of: gross selling price, discount amount, net selling price, **40% advance** required, advance amount **including 2% bKash fee**, remaining due, and due **including bKash fee**.
- Capture customer name, phone, Facebook profile, product name/description, notes, order date.
- Option to skip the advance-payment step for an order.
- Live price preview while filling the form; printable order form.

### 💬 Automated WhatsApp Messages
For every stage of an order, the app generates a ready-to-send, pre-formatted WhatsApp message (with emoji, payment instructions, bKash/bank details) that you copy with one click:
- Advance Payment Request (with bKash & bank transfer details)
- Order Confirmation
- Reached Bangladesh / Payment Options (COD, bKash, bank transfer)
- Out for Delivery
- Delivery Confirmation (review request)

### 🧾 Sales Invoices
- Create itemized invoices for a customer (independent of preorders, e.g. for direct sales).
- Apply discounts and notes.
- Printable, branded invoice layout with a QR code, per company.
- List, view, and delete past invoices.

### ✅ Paid Receipts
- Printable payment receipts generated from an order's payment history (advance and/or final payments), per company branding.

### 🧮 Expenses
- Log business expenses with description, category, amount, currency, and the account they were paid from.
- Edit/delete past entries; running summary alongside order economics.

### 📚 Books & Ledger
A mini double-entry-style bookkeeping module with six tabs:
- **Overview** — payables you owe and loan receivables owed to you, in one place.
- **Profit** — profit/loss report filterable by **This Month / This Year / All Time / custom date range**, accounting for revenue, COGS, expenses, and configurable owner draws.
- **Transactions** — full ledger of money in/out across all accounts, with type, party, account, and description; add/edit/delete entries.
- **Transfer** — move money between two accounts (e.g. Cash → Bank), with an optional transfer fee.
- **Loans** — track loans **taken** (payables) and loans **given** (receivables) by party, principal, currency, due date, and notes; record repayments against a loan.
- **Accounts** — manage cash/bank/bKash/other accounts per currency (BDT or RM), each with an opening balance and a live computed balance from the ledger.
- **Owner's Draw** — record money taken out of the business by the owner, against an account.

### 🖼️ Post Maker
A built-in tool to generate promotional product images for social media (Lazada/Shopee/Malaysia Sale/Ready Stock/Custom tags):
- Organize posts into dated **projects** (e.g. a sale campaign with a start/end date).
- Pull a product photo and title automatically from a product page URL (via public CORS proxies reading Open Graph/Twitter meta tags), or supply an image URL, or upload your own screenshot(s).
- Multiple layouts (single/duo/trio/quad image).
- Customizable colors per post; drag-to-reposition the "on sale" tag anywhere on the card.
- Download the finished post as a PNG, or share straight to Facebook.

### 📤 Export & Sync
- **CSV export** for Orders, Invoices, Expenses, Transactions, and Loans — one click per table, downloads a ready-to-open `.csv` file named per company and date.
- **Real-time Google Sheets sync** (optional, free): paste a Google Apps Script Web App URL and the app pushes every save to a Google Sheet automatically, and can pull from it on load. The app includes the exact Apps Script source to paste into [script.google.com](https://script.google.com) (`Export & Sync` tab → "Show Apps Script Code" → copy/paste → deploy as a Web App) — a 3‑minute, no-cost setup that turns Google Sheets into a shared backend/backup.

### 🏢 Multi-company
- Switch between configured company brands from the header; each brand has its own name, address, contact, and accent color, and its own isolated set of orders/invoices/expenses/ledger/loans/accounts.

### 💾 Data storage
- Everything is saved to the browser's **localStorage** automatically — no login, no server needed, data survives reloads and restarts.
- If a Google Sheets sync URL is configured, the same data is also pushed to/pulled from a Google Sheet as a durable backup / cross-device store.
- Settings (like the RM→BDT reference exchange rate used for reporting) are kept device-local.

---

## Tech stack

- [React 18](https://react.dev/)
- [Vite 8](https://vitejs.dev/) (build tool / dev server, via the Rolldown-powered bundler)
- [lucide-react](https://lucide.dev/) for icons
- No CSS framework — styled with plain CSS/inline styles
- No backend — `localStorage` + optional Google Apps Script web app for sync

## Getting started

```bash
npm install      # install dependencies
npm run dev      # start the local dev server
npm run build    # production build → dist/
npm run preview  # preview the production build locally
```

## Project structure

```
index.html          Vite entry HTML
vite.config.js       Vite + React plugin config
src/
  main.jsx           React root / app bootstrap
  App.jsx             entire application (views, components, business logic)
  App.css, index.css  global styles
  assets/             images
public/                static assets (favicon, icons)
```

## Configuration

- **Companies, bank details, pricing constants** (multiplier, advance %, bKash fee %) are defined at the top of `src/App.jsx` (`COMPANIES`, `BANK`, `COST_MULTIPLIER`, `ADVANCE_PERCENT`, `BKASH_FEE_PERCENT`) — edit these to match your business.
- **Google Sheets sync** can be enabled either by pasting a Web App URL into the `Export & Sync` tab at runtime, or by hardcoding it into the `API_URL` constant near the top of `src/App.jsx`.
