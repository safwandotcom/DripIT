import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  LayoutDashboard, ShoppingBag, Receipt, Plus, Search, Copy, Check, X,
  Package, Truck, CheckCircle2, Clock, TrendingUp, Wallet,
  Download, Trash2, ChevronRight, ChevronDown, AlertCircle, MessageSquare,
  Calendar, Phone, MapPin, FileSpreadsheet, BookOpen, FileText,
  Edit3, Printer, QrCode, ArrowUpRight, ArrowDownRight, Building2,
  Banknote, Landmark, ArrowLeftRight, Pencil, Save, Eye, Upload
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════
// COMPANIES & CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const COMPANIES = {
  drip_ittt: {
    id: 'drip_ittt',
    displayName: 'drip_ittt',
    address: 'Dhaka, Bangladesh',
    contact: '+8801843800538',
    accent: '#B5482E'
  },
  NOVUS: {
    id: 'NOVUS',
    displayName: 'NOVUS',
    address: 'Dhaka, Bangladesh',
    contact: '+8801843800538',
    accent: '#3A6FA1'
  }
};

const BANK = {
  bkash: '+880143800538',
  accountNumber: '2933240599001',
  bankName: 'The City Bank Ltd',
  branch: 'Mouchak Branch',
  accountHolder: 'Mohammed Safwanul Islam'
};

const COST_MULTIPLIER = 50;
const ADVANCE_PERCENT = 0.4;
const BKASH_FEE_PERCENT = 0.02;

const STATUS = {
  pending: { label: 'Pending', color: '#92400E', bg: '#FEF3C7' },
  advance_paid: { label: 'Advance Paid', color: '#9A3412', bg: '#FFEDD5' },
  order_confirmed: { label: 'Order Confirmed', color: '#1E40AF', bg: '#DBEAFE' },
  reached_bd: { label: 'Reached Bangladesh', color: '#5B21B6', bg: '#EDE9FE' },
  on_the_way: { label: 'On the Way', color: '#9F1239', bg: '#FFE4E6' },
  delivered: { label: 'Delivered', color: '#065F46', bg: '#D1FAE5' },
  cancelled: { label: 'Cancelled', color: '#525252', bg: '#F5F5F5' }
};

const STATUS_ORDER = ['pending', 'advance_paid', 'order_confirmed', 'reached_bd', 'on_the_way', 'delivered'];

const T = {
  cream: '#F7F4EE', surface: '#FFFFFF', ink: '#0F0F0F', inkSoft: '#3A3A3A',
  muted: '#7A7263', border: '#E5DFD0', borderSoft: '#EFEBE0',
  terracotta: '#B5482E', terracottaDark: '#8E3722', olive: '#5A6B3A',
  success: '#2D6A4F', warning: '#C77D24',
  paidRed: '#C8102E', paidRedSoft: '#FCE8EC',
  pink: '#E5337A', purple: '#6B4FA8', blue: '#3A6FA1', cyan: '#0A7EA4',
  amber: '#D97706', emerald: '#059669', rose: '#E11D48', indigo: '#4F46E5',
  serif: "'Fraunces', 'Playfair Display', Georgia, serif",
  sans: "'Space Grotesk', 'Inter Tight', -apple-system, BlinkMacSystemFont, sans-serif",
  display: "'Space Grotesk', 'Inter Tight', sans-serif",
};

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════
const fmtBDT = (n) => {
  const v = Number(n || 0);
  // Show up to 2 decimals, but drop trailing zeros (e.g. 9730.5 → "9,730.5", 11900 → "11,900")
  const hasDecimals = Math.abs(v % 1) > 0.0000001;
  return `BDT ${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};
const fmtRM = (n) => `RM ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtMoney = (n, cur) => cur === 'RM' ? fmtRM(n) : fmtBDT(n);
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateShort = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';
const fmtDateInput = (iso) => iso ? new Date(iso).toISOString().slice(0, 10) : '';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Compute the selling price of ONE item.
// An item can be priced two ways:
//   - priceMode 'multiplier': sellingEach = costRM * multiplier
//   - priceMode 'fixed':      sellingEach = sellingBDT (typed directly)
// Falls back gracefully for legacy items that only have costRM.
const calcItemSelling = (item, orderMultiplier) => {
  const costRM = parseFloat(item.costRM) || 0;
  const qty = parseFloat(item.qty) || 1;
  let sellingEach;
  if (item.priceMode === 'fixed') {
    sellingEach = parseFloat(item.sellingBDT) || 0;
  } else {
    const m = parseFloat(item.multiplier) || parseFloat(orderMultiplier) || COST_MULTIPLIER;
    sellingEach = costRM * m;
  }
  return { costRM, qty, sellingEach, lineCost: costRM * qty, lineSelling: sellingEach * qty };
};

// calcOrder accepts EITHER:
//   - a number/string (legacy: single cost in RM, uses default 50× multiplier)
//   - an order object with { items:[...], multiplier, costPriceRM, discountType, discountValue }
// Backwards-compatible: old orders with only costPriceRM still work exactly as before.
const calcOrder = (input) => {
  let cost = 0;          // total cost in RM
  let grossSelling = 0;  // selling before discount
  let multiplier = COST_MULTIPLIER;
  let discountType = 'none';
  let discountValue = 0;

  if (input && typeof input === 'object') {
    multiplier = parseFloat(input.multiplier) || COST_MULTIPLIER;
    discountType = input.discountType || 'none';
    discountValue = parseFloat(input.discountValue) || 0;

    if (Array.isArray(input.items) && input.items.length > 0) {
      input.items.forEach(it => {
        const r = calcItemSelling(it, multiplier);
        cost += r.lineCost;
        grossSelling += r.lineSelling;
      });
    } else {
      // Old-style single-item order
      cost = parseFloat(input.costPriceRM) || 0;
      grossSelling = cost * multiplier;
    }
  } else {
    cost = parseFloat(input) || 0;
    grossSelling = cost * multiplier;
  }

  // Apply discount
  let discountAmount = 0;
  if (discountType === 'percent') discountAmount = grossSelling * (discountValue / 100);
  else if (discountType === 'amount') discountAmount = discountValue;
  discountAmount = Math.min(discountAmount, grossSelling); // never below zero

  const selling = Math.max(0, grossSelling - discountAmount);
  const advance = selling * ADVANCE_PERCENT;
  const advanceBkash = advance * (1 + BKASH_FEE_PERCENT);
  const due = selling - advance;
  const dueBkash = due * (1 + BKASH_FEE_PERCENT);
  return { cost, multiplier, grossSelling, discountType, discountValue, discountAmount, selling, advance, advanceBkash, due, dueBkash };
};

const monthKey = (iso) => iso ? new Date(iso).toISOString().slice(0, 7) : '';
const monthLabel = (key) => key ? new Date(key + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '';

// ═══════════════════════════════════════════════════════════════════
// MESSAGE TEMPLATES
// ═══════════════════════════════════════════════════════════════════
const messages = {
  advance: (o, company) => {
    const c = calcOrder(o);
    return `Hello ${o.customerName}! 🌟

Thank you for ordering with ${company.displayName}. Your item is awaiting advance payment confirmation.

━━━━━━━━━━━━━━━━━━━━
📦 ORDER SUMMARY
━━━━━━━━━━━━━━━━━━━━
Item: ${o.productName}
Total Price: ${fmtBDT(c.selling)}
Advance (40%): ${fmtBDT(c.advance)}

━━━━━━━━━━━━━━━━━━━━
💳 PAYMENT OPTIONS
━━━━━━━━━━━━━━━━━━━━

📱 bKash Send Money
Number: ${BANK.bkash}
(Please add 2% extra for bKash)
Total via bKash: ${fmtBDT(c.advanceBkash)}

🏦 Bank Transfer
A/C No: ${BANK.accountNumber}
Bank: ${BANK.bankName}
Branch: ${BANK.branch}
Name: ${BANK.accountHolder}

Please share the transaction reference once payment is done.

— ${company.displayName} ❤️`;
  },
  confirmed: (o, company) => `Wonderful news, ${o.customerName}! ✅

Your payment has been received and your order is now confirmed with ${company.displayName}.

━━━━━━━━━━━━━━━━━━━━
📋 ORDER CONFIRMATION
━━━━━━━━━━━━━━━━━━━━
Order Number: ${o.orderNumber}
Item: ${o.productName}

⏱️ Standard delivery: 3–4 weeks
🍀 If we're lucky: 2 weeks

We've placed your order in Malaysia and will update you at every step.

— ${company.displayName}`,
  reachedBD: (o, company) => {
    const c = calcOrder(o);
    return `Exciting update, ${o.customerName}! 🛬

Your order has arrived in Bangladesh and is ready for delivery.

━━━━━━━━━━━━━━━━━━━━
📋 ORDER DETAILS
━━━━━━━━━━━━━━━━━━━━
Order Number: ${o.orderNumber}
Item: ${o.productName}
Pending Due: ${fmtBDT(c.due)}

━━━━━━━━━━━━━━━━━━━━
💰 HOW WOULD YOU LIKE TO PAY?
━━━━━━━━━━━━━━━━━━━━

1️⃣ Cash on Delivery (COD): ${fmtBDT(c.due)}

2️⃣ bKash (Send Money): ${fmtBDT(c.dueBkash)}
   Number: ${BANK.bkash}
   (Includes 2% bKash charge)

3️⃣ Bank Transfer: ${fmtBDT(c.due)}
   A/C: ${BANK.accountNumber}
   ${BANK.bankName}, ${BANK.branch}
   ${BANK.accountHolder}

— ${company.displayName} 🚚`;
  },
  outForDelivery: (o, company) => `Great news, ${o.customerName}! 🚚

Your order ${o.orderNumber} is now out for delivery.

Item: ${o.productName}

Please keep your phone reachable. Our delivery partner will contact you shortly.

— ${company.displayName}`,
  delivered: (o, company) => `Order delivered! 🎉

Hi ${o.customerName}, we hope you love your ${o.productName}!

If you have a moment, a quick review would mean the world to us. 💛

— ${company.displayName}`
};

// ═══════════════════════════════════════════════════════════════════
// STORAGE
// ───────────────────────────────────────────────────────────────────
// Your data is saved in TWO places automatically:
//   1. Your browser's localStorage (survives sleep, restart, closing tab)
//   2. Google Sheets — IF you paste your Web App URL below
//
// 👉 TO ENABLE GOOGLE SHEETS BACKUP: paste your Apps Script Web App URL
//    into API_URL below (between the quotes). Leave it blank to use
//    localStorage only. See SETUP_GUIDE.md for how to get the URL.
//
// NOTE: In the Claude preview window data is temporary and resets.
//       On your own computer (npm run dev) localStorage is permanent.
// ═══════════════════════════════════════════════════════════════════
const API_URL = ''; // ← paste your Google Sheets Web App URL here (optional)

const KEY_TO_ENTITY = {
  po_orders: 'orders',
  po_expenses: 'expenses',
  po_ledger: 'ledger',
  po_loans: 'loans',
  po_accounts: 'accounts',
  po_invoices: 'invoices',
  po_counters: 'counters',
  po_settings: '__local__',        // settings stay on this device only
  po_current_company: '__local__'  // company toggle stays on this device only
};

// Safe localStorage wrapper — falls back to in-memory if unavailable
const _mem = {};
const _local = {
  get(key) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage.getItem(key);
    } catch (_) {}
    return _mem[key] ?? null;
  },
  set(key, value) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) { window.localStorage.setItem(key, value); return; }
    } catch (_) {}
    _mem[key] = value;
  }
};

const storage = {
  async load(key, fallback) {
    // 1) Try Google Sheets first if configured (it's the source of truth)
    const entity = KEY_TO_ENTITY[key];
    if (API_URL && entity && entity !== '__local__') {
      try {
        const res = await fetch(`${API_URL}?action=list&entity=${entity}`);
        const body = await res.json();
        if (body.ok) {
          if (entity === 'counters') {
            const merged = {};
            body.data.forEach(c => { merged[c.id] = c; });
            const result = Object.keys(merged).length ? merged : fallback;
            _local.set(key, JSON.stringify(result)); // cache locally
            return result;
          }
          _local.set(key, JSON.stringify(body.data)); // cache locally
          return body.data;
        }
      } catch (err) {
        console.warn('Sheets load failed, using local copy for', key, err);
      }
    }
    // 2) Fall back to localStorage (always works, survives sleep/restart)
    try {
      const raw = _local.get(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },

  async save(key, value) {
    // Always save locally first so nothing is ever lost
    try { _local.set(key, JSON.stringify(value)); } catch (e) { console.error(e); }

    // Then sync to Google Sheets if configured.
    // NOTE: We send body as text/plain to avoid a CORS preflight (Apps Script
    // doesn't reply to OPTIONS requests). Apps Script reads e.postData.contents
    // either way, so the JSON body still parses on the server.
    const entity = KEY_TO_ENTITY[key];
    // Effective URL: hardcoded constant OR URL saved by user in Export & Sync
    const effectiveApiUrl = (typeof window !== 'undefined' && window.__PO_SHEETS_URL__) || API_URL;
    if (!effectiveApiUrl || !entity || entity === '__local__') return;
    try {
      if (entity === 'counters') {
        for (const company of Object.keys(value)) {
          await fetch(effectiveApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'save', entity, data: { id: company, ...value[company] } })
          });
        }
      } else {
        await fetch(effectiveApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'replaceAll', entity, data: value })
        });
      }
    } catch (err) {
      console.warn('Sheets save failed (saved locally) for', key, err);
    }
  }
};

// ═══════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [view, setView] = useState('dashboard');
  const [currentCompany, setCurrentCompany] = useState('drip_ittt');
  const [loaded, setLoaded] = useState(false);

  // Data state
  const [orders, setOrders] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loans, setLoans] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [counters, setCounters] = useState({});

  // UI state
  const [toast, setToast] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [messageModal, setMessageModal] = useState(null);
  const [editingExpense, setEditingExpense] = useState(null);
  const [editingLedger, setEditingLedger] = useState(null);
  const [editingLoan, setEditingLoan] = useState(null);
  const [editingAccount, setEditingAccount] = useState(null);
  const [printInvoice, setPrintInvoice] = useState(null);
  const [printReceipt, setPrintReceipt] = useState(null);
  const [paymentPrompt, setPaymentPrompt] = useState(null); // { order, kind, defaultAmount }
  const [ownerDrawPrompt, setOwnerDrawPrompt] = useState(false);
  const [settings, setSettings] = useState({ realExchangeRate: 25 });

  // Load
  useEffect(() => {
    (async () => {
      const [o, e, l, ln, ac, inv, ct, cc, st] = await Promise.all([
        storage.load('po_orders', []),
        storage.load('po_expenses', []),
        storage.load('po_ledger', []),
        storage.load('po_loans', []),
        storage.load('po_accounts', getDefaultAccounts()),
        storage.load('po_invoices', []),
        storage.load('po_counters', { drip_ittt: { order: 1, invoice: 1 }, NOVUS: { order: 1, invoice: 1 } }),
        storage.load('po_current_company', 'drip_ittt'),
        storage.load('po_settings', { realExchangeRate: 25 })
      ]);
      setOrders(o.map(x => ({ company: 'drip_ittt', ...x })));
      setExpenses(e.map(x => ({ company: 'drip_ittt', ...x })));
      setLedger(l);
      setLoans(ln);
      setAccounts(ac);
      setInvoices(inv);
      setCounters(ct);
      setCurrentCompany(cc);
      setSettings(st);
      setLoaded(true);
    })();
  }, []);

  // Persist
  useEffect(() => { if (loaded) storage.save('po_orders', orders); }, [orders, loaded]);
  useEffect(() => { if (loaded) storage.save('po_expenses', expenses); }, [expenses, loaded]);
  useEffect(() => { if (loaded) storage.save('po_ledger', ledger); }, [ledger, loaded]);
  useEffect(() => { if (loaded) storage.save('po_loans', loans); }, [loans, loaded]);
  useEffect(() => { if (loaded) storage.save('po_accounts', accounts); }, [accounts, loaded]);
  useEffect(() => { if (loaded) storage.save('po_invoices', invoices); }, [invoices, loaded]);
  useEffect(() => { if (loaded) storage.save('po_counters', counters); }, [counters, loaded]);
  useEffect(() => { if (loaded) storage.save('po_current_company', currentCompany); }, [currentCompany, loaded]);
  useEffect(() => { if (loaded) storage.save('po_settings', settings); }, [settings, loaded]);

  // Prevent scroll wheel from changing number input values globally
  useEffect(() => {
    const handler = (e) => { if (document.activeElement?.type === 'number') e.preventDefault(); };
    document.addEventListener('wheel', handler, { passive: false });
    // Also restore the Google Sheets URL saved in ExportView
    try {
      const savedUrl = localStorage.getItem('po_sheets_url');
      if (savedUrl) window.__PO_SHEETS_URL__ = savedUrl;
    } catch {}
    return () => document.removeEventListener('wheel', handler);
  }, []);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const copyText = async (text, label = 'Copied to clipboard') => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(label);
    } catch { showToast('Copy failed', 'error'); }
  };

  const company = COMPANIES[currentCompany];

  // Filtered data
  const cOrders = useMemo(() => orders.filter(o => o.company === currentCompany), [orders, currentCompany]);
  const cExpenses = useMemo(() => expenses.filter(e => e.company === currentCompany), [expenses, currentCompany]);
  const cLedger = useMemo(() => ledger.filter(l => l.company === currentCompany), [ledger, currentCompany]);
  const cLoans = useMemo(() => loans.filter(l => l.company === currentCompany), [loans, currentCompany]);
  const cAccounts = useMemo(() => accounts.filter(a => a.company === currentCompany), [accounts, currentCompany]);
  const cInvoices = useMemo(() => invoices.filter(i => i.company === currentCompany), [invoices, currentCompany]);

  // Compute the next safe number for orders/invoices by scanning what already exists.
  // This avoids stale-state bugs when nextCounter is called twice in one render.
  const computeNextNumber = (type, companyOrders, companyInvoices, savedCounters) => {
    const items = type === 'order' ? companyOrders : companyInvoices;
    const prefix = type === 'order'
      ? (currentCompany === 'NOVUS' ? 'NV-' : 'DI-')
      : (currentCompany === 'NOVUS' ? 'NV-INV-' : 'DI-INV-');
    let maxFromData = 0;
    items.forEach(it => {
      const num = type === 'order' ? it.orderNumber : it.invoiceNumber;
      if (num && num.startsWith(prefix)) {
        const n = parseInt(num.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxFromData) maxFromData = n;
      }
    });
    const savedCounter = (savedCounters[currentCompany] || {})[type] || 1;
    return Math.max(maxFromData + 1, savedCounter);
  };

  // === ORDER OPS ===
  const addOrder = (data) => {
    const orderN = computeNextNumber('order', cOrders, cInvoices, counters);
    const invoiceN = computeNextNumber('invoice', cOrders, cInvoices, counters);
    const orderPrefix = currentCompany === 'NOVUS' ? 'NV' : 'DI';
    const invPrefix = currentCompany === 'NOVUS' ? 'NV-INV' : 'DI-INV';
    const orderNumber = `${orderPrefix}-${String(orderN).padStart(4, '0')}`;
    const invoiceNumber = `${invPrefix}-${String(invoiceN).padStart(4, '0')}`;

    // Bump both counters in a single state update
    setCounters(prev => {
      const cur = prev[currentCompany] || { order: 1, invoice: 1 };
      return { ...prev, [currentCompany]: { ...cur, order: orderN + 1, invoice: invoiceN + 1 } };
    });

    const newOrder = {
      id: uid(), company: currentCompany, orderNumber, ...data,
      status: data.skipAdvance ? 'order_confirmed' : 'pending',
      advancePaid: !!data.skipAdvance,
      orderPlacedMY: !!data.skipAdvance,
      reachedBD: false, onTheWay: false, delivered: false,
      skipAdvance: data.skipAdvance || false,
      orderDate: data.orderDate || new Date().toISOString()
    };
    setOrders(prev => [newOrder, ...prev]);

    // Auto-create matching invoice for this order — one line per item
    const calc = calcOrder(data);
    const usedMultiplier = parseFloat(data.multiplier) || COST_MULTIPLIER;

    // Build invoice line items from the order items (or fall back to single-item)
    const sourceItems = Array.isArray(data.items) && data.items.length > 0
      ? data.items
      : [{ productName: data.productName, productDescription: data.productDescription, costRM: data.costPriceRM, qty: 1 }];

    const invoiceItems = sourceItems.map(it => {
      const r = calcItemSelling(it, usedMultiplier);
      return {
        id: uid(),
        name: (it.productName || '') + (it.productDescription ? ` — ${it.productDescription}` : ''),
        costRM: r.costRM,
        rate: it.priceMode === 'fixed' ? null : (parseFloat(it.multiplier) || usedMultiplier),
        qty: r.qty,
        totalBDT: r.lineSelling
      };
    });

    const autoInvoice = {
      id: uid(), company: currentCompany, invoiceNumber,
      date: newOrder.orderDate,
      customer: {
        name: data.customerName,
        phone: data.customerPhone || '',
        address: data.customerAddress || ''
      },
      items: invoiceItems,
      defaultRate: usedMultiplier,
      subtotal: calc.grossSelling,
      discount: calc.discountAmount,
      discountType: calc.discountType,
      discountValue: calc.discountValue,
      total: calc.selling,
      notes: data.skipAdvance
        ? `Full payment due on delivery: ${fmtBDT(calc.selling)}`
        : `Advance ${fmtBDT(calc.advance)} (40%) · Due on delivery ${fmtBDT(calc.due)}`,
      relatedOrderId: newOrder.id,
      autoGenerated: true
    };
    setInvoices(prev => [autoInvoice, ...prev]);

    // Record Cost of Goods Sold (COGS) — deducts from Malaysian (RM) account
    // because the purchase happens in Malaysia and is paid in Ringgit.
    const costRM = parseFloat(data.costPriceRM) || 0;
    if (costRM > 0) {
      // Find the first RM-currency account for this company; fall back to 'Cash (Malaysia)'
      const rmAccount = accounts.find(a => a.company === currentCompany && (a.currency === 'RM'));
      const rmAccountName = rmAccount?.name || 'Cash (Malaysia)';
      setLedger(prev => [{
        id: uid(), company: currentCompany, date: newOrder.orderDate,
        direction: 'out', type: 'COGS · Cost of Goods',
        account: rmAccountName,
        party: data.customerName,
        amount: costRM, currency: 'RM',
        description: `${orderNumber} — ${data.productName} (RM ${costRM} × ${data.conversionRate} = ${fmtBDT(parseFloat(data.cogsBDT) || 0)} equivalent)`,
        relatedOrderId: newOrder.id, kind: 'cogs'
      }, ...prev]);
    }

    showToast(`${orderNumber} created · Invoice ${invoiceNumber} ready`);
    setSelectedOrder(newOrder);
    setView('orders');
    // If user clicked "Create & Print Invoice", open the print modal directly
    if (data.printAfter) {
      setPrintInvoice(autoInvoice);
    } else if (data.skipAdvance) {
      // For trust orders, skip the advance request and show order-confirmed instead
      setMessageModal({ order: newOrder, type: 'confirmed' });
    } else {
      setMessageModal({ order: newOrder, type: 'advance' });
    }
  };

  const updateOrder = (id, updates) => {
    setOrders(orders.map(o => {
      if (o.id !== id) return o;
      const newO = { ...o, ...updates };
      if (newO.delivered) newO.status = 'delivered';
      else if (newO.onTheWay) newO.status = 'on_the_way';
      else if (newO.reachedBD) newO.status = 'reached_bd';
      else if (newO.advancePaid && newO.orderPlacedMY) newO.status = 'order_confirmed';
      else if (newO.advancePaid) newO.status = 'advance_paid';
      else newO.status = 'pending';
      return newO;
    }));
    if (selectedOrder?.id === id) setSelectedOrder(prev => ({ ...prev, ...updates }));
  };

  const deleteOrder = (id) => {
    if (!confirm('Delete this order permanently? Any linked payment entries and auto-generated invoice will also be removed.')) return;
    setOrders(prev => prev.filter(o => o.id !== id));
    setLedger(prev => prev.filter(l => l.relatedOrderId !== id));
    setInvoices(prev => prev.filter(i => i.relatedOrderId !== id));
    setSelectedOrder(null);
    showToast('Order, invoice, and linked entries deleted');
  };

  // === ORDER PAYMENT FLOW (auto-creates ledger entries) ===
  const requireOrderPayment = (order, kind) => {
    // kind = 'order_advance' or 'order_final'
    const c = calcOrder(order);
    let defaultAmount;
    if (kind === 'order_advance') {
      defaultAmount = c.advance;
    } else {
      // For trust orders (no advance), final payment is the full selling price
      defaultAmount = order.skipAdvance ? c.selling : c.due;
    }
    setPaymentPrompt({ order, kind, defaultAmount });
  };

  const confirmOrderPayment = (details) => {
    const { order, kind } = paymentPrompt;
    // details.splits = [{ amount, account, method, notes }], details.date
    const splits = (details.splits || []).filter(s => parseFloat(s.amount) > 0);
    const dateISO = new Date(details.date).toISOString();
    const typeLabel = kind === 'order_advance' ? 'Advance Payment' : 'Final Payment';

    // Create one ledger entry per split
    const newEntries = splits.map(s => ({
      id: uid(), company: order.company, date: dateISO,
      direction: 'in', type: typeLabel,
      account: s.account, party: order.customerName,
      amount: parseFloat(s.amount), currency: 'BDT',
      description: `${order.orderNumber} — ${order.productName}${s.method ? ` · via ${s.method}` : ''}${s.notes ? ` · ${s.notes}` : ''}`,
      relatedOrderId: order.id, kind
    }));
    setLedger(prev => [...newEntries, ...prev]);

    // Cascade-update checkpoints
    const checkpointKey = kind === 'order_advance' ? 'advancePaid' : 'delivered';
    const cascadeKeys = checkpointKey === 'advancePaid'
      ? ['advancePaid']
      : ['advancePaid', 'orderPlacedMY', 'reachedBD', 'onTheWay', 'delivered'];
    const updates = {};
    cascadeKeys.forEach(k => { updates[k] = true; });
    updateOrder(order.id, updates);

    const total = splits.reduce((s, x) => s + parseFloat(x.amount), 0);
    setPaymentPrompt(null);
    showToast(splits.length > 1
      ? `Payment recorded: ${fmtBDT(total)} across ${splits.length} methods`
      : `Payment recorded: ${fmtBDT(total)} → ${splits[0]?.account || ''}`);
  };

  const removeOrderPayment = (orderId, kind) => {
    setLedger(prev => prev.filter(l => !(l.relatedOrderId === orderId && l.kind === kind)));
  };

  // === EXPENSE OPS (auto-syncs to ledger) ===
  const addExpense = (data) => {
    const expense = { id: uid(), company: currentCompany, ...data };
    setExpenses(prev => [expense, ...prev]);
    // Auto-create matching ledger entry
    if (data.account) {
      setLedger(prev => [{
        id: uid(), company: currentCompany, date: data.date,
        direction: 'out', type: `Expense · ${data.category}`,
        account: data.account, party: '',
        amount: data.amount, currency: data.currency,
        description: data.description,
        relatedExpenseId: expense.id, kind: 'expense'
      }, ...prev]);
    }
    showToast('Expense recorded & ledger updated');
  };

  const updateExpense = (id, updates) => {
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
    // Sync the matching ledger entry
    setLedger(prev => prev.map(l => {
      if (l.relatedExpenseId !== id) return l;
      return {
        ...l, date: updates.date || l.date,
        type: `Expense · ${updates.category || l.type.replace('Expense · ', '')}`,
        account: updates.account || l.account,
        amount: updates.amount !== undefined ? updates.amount : l.amount,
        currency: updates.currency || l.currency,
        description: updates.description !== undefined ? updates.description : l.description
      };
    }));
    showToast('Expense updated');
  };

  const deleteExpense = (id) => {
    if (!confirm('Delete this expense and its ledger entry?')) return;
    setExpenses(prev => prev.filter(e => e.id !== id));
    setLedger(prev => prev.filter(l => l.relatedExpenseId !== id));
    showToast('Expense deleted');
  };

  // === LEDGER OPS ===
  const addLedger = (data) => {
    setLedger([{ id: uid(), company: currentCompany, ...data }, ...ledger]);
    showToast('Transaction recorded');
  };
  const updateLedger = (id, updates) => {
    setLedger(ledger.map(l => l.id === id ? { ...l, ...updates } : l));
    showToast('Transaction updated');
  };
  const deleteLedger = (id) => {
    if (!confirm('Delete this transaction?')) return;
    setLedger(ledger.filter(l => l.id !== id));
    showToast('Transaction deleted');
  };

  // === LOAN OPS ===
  const addLoan = (data) => {
    const loan = { id: uid(), company: currentCompany, amountRepaid: 0, status: 'open', ...data };
    setLoans([loan, ...loans]);
    // Auto-add to ledger
    const direction = loan.type === 'taken' ? 'in' : 'out';
    setLedger([{
      id: uid(), company: currentCompany, date: loan.date, direction,
      type: loan.type === 'taken' ? 'Loan Taken' : 'Loan Given',
      amount: loan.principal, currency: loan.currency,
      account: loan.account || 'Cash', party: loan.party,
      description: `${loan.type === 'taken' ? 'Borrowed from' : 'Lent to'} ${loan.party}`,
      relatedLoanId: loan.id
    }, ...ledger]);
    showToast('Loan recorded');
  };
  const updateLoan = (id, updates) => {
    setLoans(loans.map(l => l.id === id ? { ...l, ...updates } : l));
    showToast('Loan updated');
  };
  const deleteLoan = (id) => {
    if (!confirm('Delete this loan and its ledger entries?')) return;
    setLoans(loans.filter(l => l.id !== id));
    setLedger(ledger.filter(l => l.relatedLoanId !== id));
    showToast('Loan deleted');
  };
  const recordRepayment = (loan, amount, date) => {
    const newRepaid = (loan.amountRepaid || 0) + parseFloat(amount);
    const newStatus = newRepaid >= loan.principal ? 'settled' : 'open';
    updateLoan(loan.id, { amountRepaid: newRepaid, status: newStatus });
    const direction = loan.type === 'taken' ? 'out' : 'in';
    addLedger({
      date, direction,
      type: loan.type === 'taken' ? 'Loan Repayment Paid' : 'Loan Repayment Received',
      amount: parseFloat(amount), currency: loan.currency,
      account: loan.account || 'Cash', party: loan.party,
      description: `Repayment ${loan.type === 'taken' ? 'to' : 'from'} ${loan.party}`,
      relatedLoanId: loan.id
    });
  };

  // === TRANSFER OPS ===
  // Move money between accounts. Same-currency = simple. Cross-currency uses the rate provided.
  // Optional fee is logged as a separate expense entry against the source account.
  const recordTransfer = (data) => {
    // data: { fromAccount, toAccount, fromCurrency, toCurrency, fromAmount, rate, toAmount, fee, feeAccount, date, notes }
    const transferId = uid();
    const dateISO = new Date(data.date).toISOString();
    const fromAmt = parseFloat(data.fromAmount) || 0;
    const toAmt = parseFloat(data.toAmount) || 0;
    const feeAmt = parseFloat(data.fee) || 0;

    if (fromAmt <= 0 || toAmt <= 0) return;

    const isCrossCurrency = data.fromCurrency !== data.toCurrency;
    const baseDesc = isCrossCurrency
      ? `Transfer ${data.fromAccount} → ${data.toAccount} @ rate ${data.rate}${data.notes ? ` · ${data.notes}` : ''}`
      : `Transfer ${data.fromAccount} → ${data.toAccount}${data.notes ? ` · ${data.notes}` : ''}`;

    // OUT from source
    const outEntry = {
      id: uid(), company: currentCompany, date: dateISO,
      direction: 'out', type: 'Transfer Out',
      account: data.fromAccount, party: data.toAccount,
      amount: fromAmt, currency: data.fromCurrency,
      description: baseDesc,
      relatedTransferId: transferId, kind: 'transfer'
    };

    // IN to destination
    const inEntry = {
      id: uid(), company: currentCompany, date: dateISO,
      direction: 'in', type: 'Transfer In',
      account: data.toAccount, party: data.fromAccount,
      amount: toAmt, currency: data.toCurrency,
      description: baseDesc,
      relatedTransferId: transferId, kind: 'transfer'
    };

    const newLedger = [outEntry, inEntry];

    // Optional fee — logged both as an expense AND a ledger out
    let feeCurrency = 'BDT';
    if (feeAmt > 0 && data.feeAccount) {
      feeCurrency = (accounts.find(a => a.company === currentCompany && a.name === data.feeAccount)?.currency) || 'BDT';
      const feeId = uid();
      const feeDesc = `Transfer fee: ${data.fromAccount} → ${data.toAccount}`;

      // Add to expenses list
      setExpenses(prev => [{
        id: feeId,
        company: currentCompany,
        date: dateISO,
        description: feeDesc,
        category: 'Payment Fees',
        amount: feeAmt,
        currency: feeCurrency,
        account: data.feeAccount,
        relatedTransferId: transferId
      }, ...prev]);

      // And add matching ledger entry
      newLedger.push({
        id: uid(), company: currentCompany, date: dateISO,
        direction: 'out', type: 'Expense · Payment Fees',
        account: data.feeAccount, party: '',
        amount: feeAmt, currency: feeCurrency,
        description: feeDesc,
        relatedTransferId: transferId, relatedExpenseId: feeId, kind: 'expense'
      });
    }

    setLedger(prev => [...newLedger, ...prev]);
    const summary = isCrossCurrency
      ? `${fmtMoney(fromAmt, data.fromCurrency)} → ${fmtMoney(toAmt, data.toCurrency)}`
      : fmtMoney(fromAmt, data.fromCurrency);
    showToast(`Transferred ${summary}${feeAmt > 0 ? ` · fee ${fmtMoney(feeAmt, feeCurrency)}` : ''}`);
  };

  // === ACCOUNT OPS ===
  const addAccount = (data) => {
    setAccounts([...accounts, { id: uid(), company: currentCompany, ...data }]);
    showToast('Account added');
  };
  const updateAccount = (id, updates) => {
    setAccounts(accounts.map(a => a.id === id ? { ...a, ...updates } : a));
    showToast('Account updated');
  };
  const deleteAccount = (id) => {
    if (!confirm('Delete this account? Existing transactions will remain.')) return;
    setAccounts(accounts.filter(a => a.id !== id));
    showToast('Account deleted');
  };

  // === INVOICE OPS ===
  const addInvoice = (data) => {
    const n = computeNextNumber('invoice', cOrders, cInvoices, counters);
    const prefix = currentCompany === 'NOVUS' ? 'NV-INV' : 'DI-INV';
    const invoiceNumber = `${prefix}-${String(n).padStart(4, '0')}`;
    setCounters(prev => {
      const cur = prev[currentCompany] || { order: 1, invoice: 1 };
      return { ...prev, [currentCompany]: { ...cur, invoice: n + 1 } };
    });
    const inv = { id: uid(), company: currentCompany, invoiceNumber, ...data };
    setInvoices([inv, ...invoices]);
    showToast(`Invoice ${invoiceNumber} created`);
    setPrintInvoice(inv);
  };
  const updateInvoice = (id, updates) => {
    setInvoices(invoices.map(i => i.id === id ? { ...i, ...updates } : i));
    showToast('Invoice updated');
  };
  const deleteInvoice = (id) => {
    if (!confirm('Delete this invoice?')) return;
    setInvoices(invoices.filter(i => i.id !== id));
    showToast('Invoice deleted');
  };

  // === STATS ===
  const stats = useMemo(() => {
    const realRate = parseFloat(settings.realExchangeRate) || 25;
    const delivered = cOrders.filter(o => o.status === 'delivered');
    const totalRevenue = delivered.reduce((s, o) => s + calcOrder(o).selling, 0);
    const advanceReceived = cOrders.filter(o => o.advancePaid && !o.delivered).reduce((s, o) => s + calcOrder(o).advance, 0);
    const pendingDues = cOrders.filter(o => o.reachedBD && !o.delivered).reduce((s, o) => s + calcOrder(o).due, 0);
    const totalOrders = cOrders.length;
    const activeOrders = cOrders.filter(o => !['delivered', 'cancelled'].includes(o.status)).length;

    // COGS — from ledger entries (kind === 'cogs'), now stored in RM
    // Convert RM → BDT using the real conversion rate for profit calculations
    const cogsTosBDT = (l) => {
      const amt = parseFloat(l.amount || 0);
      if ((l.currency || 'RM') === 'RM') return amt * realRate;
      return amt; // legacy BDT entries
    };
    const totalCOGS = cLedger.filter(l => l.kind === 'cogs').reduce((s, l) => s + cogsTosBDT(l), 0);
    // COGS attributable to delivered orders only (for matched net profit)
    const deliveredIds = new Set(delivered.map(o => o.id));
    const deliveredCOGS = cLedger.filter(l => l.kind === 'cogs' && deliveredIds.has(l.relatedOrderId)).reduce((s, l) => s + cogsTosBDT(l), 0);

    // Operating expenses (exclude COGS entries; those are tracked separately)
    const expensesRM = cExpenses.filter(e => e.currency === 'RM').reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const expensesBDT = cExpenses.filter(e => e.currency === 'BDT').reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const totalExpensesBDT = expensesBDT + (expensesRM * realRate); // use REAL rate, not selling multiplier

    const totalPayable = cLoans.filter(l => l.type === 'taken' && l.status === 'open').reduce((s, l) => s + (l.principal - (l.amountRepaid || 0)), 0);
    const totalReceivable = cLoans.filter(l => l.type === 'given' && l.status === 'open').reduce((s, l) => s + (l.principal - (l.amountRepaid || 0)), 0);

    // Net profit = revenue from delivered − COGS of those delivered − operating expenses
    const netProfit = totalRevenue - deliveredCOGS - totalExpensesBDT;

    return { totalRevenue, advanceReceived, pendingDues, totalOrders, activeOrders, expensesRM, expensesBDT, totalExpensesBDT, totalPayable, totalReceivable, totalCOGS, deliveredCOGS, netProfit };
  }, [cOrders, cExpenses, cLoans, cLedger, settings]);

  // ── Navigation guard for PostMaker ── (must be before any early return)
  const [pendingNav, setPendingNav] = useState(null);
  const [showNavGuard, setShowNavGuard] = useState(false);
  const handleNavRequest = (targetView) => {
    if (view === 'postmaker') { setPendingNav(targetView); setShowNavGuard(true); }
    else setView(targetView);
  };
  const confirmNav = () => { setView(pendingNav); setPendingNav(null); setShowNavGuard(false); };
  const cancelNav = () => { setPendingNav(null); setShowNavGuard(false); };

  if (!loaded) {
    return <div style={{ background: T.cream, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.sans, color: T.muted }}>Loading…</div>;
  }

  return (
    <div style={{ background: T.cream, minHeight: '100vh', fontFamily: T.sans, color: T.ink }}>
      <GlobalStyles />

      {/* Navigation guard modal */}
      {showNavGuard && (
        <div onClick={cancelNav} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
          <div onClick={e => e.stopPropagation()} className="fade-in" style={{ background: T.surface, borderRadius: 14, padding: 28, maxWidth: 400, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontFamily: T.serif, fontSize: 22, fontWeight: 500, color: T.ink, marginBottom: 10 }}>Leave Post Maker?</div>
            <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.7, marginBottom: 22 }}>
              You're in the middle of a project. <strong style={{ color: T.ink }}>Projects are not saved</strong> — once you leave, your work and all generated images will be lost.<br /><br />
              Download any images you need before leaving.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={cancelNav} className="pcg-btn pcg-btn-secondary">Stay & Finish</button>
              <button onClick={confirmNav} className="pcg-btn" style={{ background: T.terracotta }}>Leave Anyway</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar view={view} setView={handleNavRequest} />
        <main style={{ flex: 1, padding: '28px 36px', maxWidth: 'calc(100vw - 240px)' }}>
          <Header view={view} stats={stats} company={company} currentCompany={currentCompany} setCurrentCompany={setCurrentCompany} />
          <div className="fade-in" key={view + currentCompany} style={{ marginTop: 24 }}>
            {view === 'dashboard' && <Dashboard stats={stats} orders={cOrders} loans={cLoans} accounts={cAccounts} ledger={cLedger} onOpenOrder={setSelectedOrder} />}
            {view === 'orders' && <Orders orders={cOrders} invoices={cInvoices} accounts={cAccounts} ledger={cLedger} company={company} onOpenOrder={setSelectedOrder} onNew={() => handleNavRequest('new')} onUpdateOrder={updateOrder} onRequirePayment={requireOrderPayment} onRemovePayment={removeOrderPayment} onShowInvoice={setPrintInvoice} onShowReceipt={setPrintReceipt} copyText={copyText} />}
            {view === 'new' && <NewOrder onSubmit={addOrder} onCancel={() => handleNavRequest('orders')} defaultRate={settings.realExchangeRate} />}
            {view === 'expenses' && <Expenses expenses={cExpenses} accounts={cAccounts} onAdd={addExpense} onDelete={deleteExpense} onEdit={setEditingExpense} stats={stats} />}
            {view === 'books' && <Books accounts={cAccounts} ledger={cLedger} loans={cLoans} orders={cOrders} expenses={cExpenses} settings={settings} setSettings={setSettings} onAddAccount={addAccount} onEditAccount={setEditingAccount} onDeleteAccount={deleteAccount} onAddLedger={addLedger} onEditLedger={setEditingLedger} onDeleteLedger={deleteLedger} onAddLoan={addLoan} onEditLoan={setEditingLoan} onDeleteLoan={deleteLoan} onRepay={recordRepayment} onOwnerDraw={() => setOwnerDrawPrompt(true)} onOpenOrder={setSelectedOrder} onTransfer={recordTransfer} />}
            {view === 'invoices' && <Invoices invoices={cInvoices} onAdd={addInvoice} onPrint={setPrintInvoice} onDelete={deleteInvoice} company={company} />}
            {view === 'receipts' && <Receipts orders={cOrders} ledger={cLedger} company={company} onShowReceipt={setPrintReceipt} onOpenOrder={setSelectedOrder} />}
            {view === 'export' && <ExportView orders={cOrders} expenses={cExpenses} ledger={cLedger} loans={cLoans} invoices={cInvoices} showToast={showToast} company={company} />}
            {view === 'postmaker' && <PostMaker company={company} showToast={showToast} />}
          </div>
        </main>
      </div>

      {selectedOrder && <OrderModal order={selectedOrder} company={company} accounts={cAccounts} onClose={() => setSelectedOrder(null)} onUpdate={updateOrder} onDelete={deleteOrder} onShowMessage={(type) => setMessageModal({ order: selectedOrder, type })} onRequirePayment={requireOrderPayment} onRemovePayment={removeOrderPayment} ledger={cLedger} invoices={cInvoices} onShowInvoice={setPrintInvoice} onShowReceipt={setPrintReceipt} />}
      {messageModal && <MessageModal order={messageModal.order} type={messageModal.type} company={company} onClose={() => setMessageModal(null)} copyText={copyText} />}
      {editingExpense && <ExpenseEditModal expense={editingExpense} accounts={cAccounts} onClose={() => setEditingExpense(null)} onSave={(updates) => { updateExpense(editingExpense.id, updates); setEditingExpense(null); }} />}
      {editingLedger && <LedgerEditModal entry={editingLedger} accounts={cAccounts} onClose={() => setEditingLedger(null)} onSave={(updates) => { updateLedger(editingLedger.id, updates); setEditingLedger(null); }} />}
      {editingLoan && <LoanEditModal loan={editingLoan} onClose={() => setEditingLoan(null)} onSave={(updates) => { updateLoan(editingLoan.id, updates); setEditingLoan(null); }} onRepay={(amt, date) => { recordRepayment(editingLoan, amt, date); setEditingLoan(null); }} />}
      {editingAccount && <AccountEditModal account={editingAccount} onClose={() => setEditingAccount(null)} onSave={(updates) => { updateAccount(editingAccount.id, updates); setEditingAccount(null); }} />}
      {printInvoice && <InvoicePrintModal invoice={printInvoice} company={company} onClose={() => setPrintInvoice(null)} onUpdate={updateInvoice} />}
      {printReceipt && <ReceiptPrintModal order={printReceipt.order} payments={printReceipt.payments} company={printReceipt.company} onClose={() => setPrintReceipt(null)} />}
      {paymentPrompt && <OrderPaymentModal prompt={paymentPrompt} accounts={cAccounts} onCancel={() => setPaymentPrompt(null)} onConfirm={confirmOrderPayment} />}
      {ownerDrawPrompt && <OwnerDrawModal accounts={cAccounts} onCancel={() => setOwnerDrawPrompt(false)} onConfirm={(d) => { addLedger({ ...d, kind: 'owner_draw' }); setOwnerDrawPrompt(false); }} />}

      {toast && <Toast toast={toast} />}
    </div>
  );
}

function getDefaultAccounts() {
  const out = [];
  ['drip_ittt', 'NOVUS'].forEach(co => {
    out.push({ id: uid() + '_' + co + '_1', company: co, name: 'Bank — City Bank', type: 'Bank', openingBalance: 0, currency: 'BDT' });
    out.push({ id: uid() + '_' + co + '_2', company: co, name: 'bKash', type: 'bKash', openingBalance: 0, currency: 'BDT' });
    out.push({ id: uid() + '_' + co + '_3', company: co, name: 'Cash', type: 'Cash', openingBalance: 0, currency: 'BDT' });
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// GLOBAL STYLES
// ═══════════════════════════════════════════════════════════════════
function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter+Tight:wght@300;400;500;600;700&family=Space+Grotesk:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap');
      * { box-sizing: border-box; }
      body { margin: 0; font-family: ${T.sans}; }
      input, select, textarea, button { font-family: inherit; }
      .pcg-input {
        width: 100%; padding: 10px 14px;
        background: ${T.surface}; border: 1px solid ${T.border};
        border-radius: 8px; color: ${T.ink}; font-size: 14px;
        transition: all 0.15s; outline: none;
      }
      .pcg-input:focus { border-color: ${T.terracotta}; box-shadow: 0 0 0 3px ${T.terracotta}15; }
      .pcg-input[type="number"]::-webkit-outer-spin-button,
      .pcg-input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      .pcg-input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
      /* Prevent scroll wheel from changing number input values */
      input[type="number"] { pointer-events: auto; }
      input[type="number"]:focus { outline: none; }
      .pcg-label {
        display: block; font-size: 11px; font-weight: 500; color: ${T.muted};
        margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.06em;
      }
      .pcg-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 9px 16px; background: ${T.ink}; color: ${T.cream};
        border: none; border-radius: 8px; font-size: 13px; font-weight: 500;
        cursor: pointer; transition: all 0.15s;
      }
      .pcg-btn:hover { background: ${T.terracottaDark}; }
      .pcg-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .pcg-btn-secondary { background: ${T.surface}; color: ${T.ink}; border: 1px solid ${T.border}; }
      .pcg-btn-secondary:hover { background: ${T.cream}; border-color: ${T.ink}; }
      .pcg-btn-ghost { background: transparent; color: ${T.muted}; border: none; padding: 6px 10px; }
      .pcg-btn-ghost:hover { color: ${T.ink}; background: ${T.cream}; }
      .pcg-btn-sm { padding: 6px 10px; font-size: 12px; }
      .pcg-card { background: ${T.surface}; border: 1px solid ${T.borderSoft}; border-radius: 12px; padding: 20px; }
      .pcg-row { transition: background 0.15s; }
      .pcg-row:hover { background: ${T.cream}; cursor: pointer; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 4px; }
      .fade-in { animation: fadeIn 0.25s ease-out; }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @media print {
        body * { visibility: hidden; }
        .print-area, .print-area * { visibility: visible; }
        .print-area { position: absolute; left: 0; top: 0; width: 210mm; padding: 15mm 18mm; }
        .no-print { display: none !important; }
        @page { size: A4 portrait; margin: 12mm 15mm; }
      }
    `}</style>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SIDEBAR & HEADER
// ═══════════════════════════════════════════════════════════════════
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
    { id: 'export', label: 'Export & Sync', icon: FileSpreadsheet }
  ];

  return (
    <aside className="no-print" style={{ width: 240, background: T.surface, borderRight: `1px solid ${T.borderSoft}`, padding: '24px 14px', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
      <div style={{ padding: '0 8px 24px', borderBottom: `1px solid ${T.borderSoft}`, marginBottom: 18 }}>
        <div style={{ fontFamily: T.display, fontSize: 24, fontWeight: 700, letterSpacing: '-0.04em', color: T.ink }}>
          PRE<span style={{ color: T.paidRed }}>·</span>ORDER
        </div>
        <div style={{ fontSize: 10.5, color: T.muted, marginTop: 5, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 600 }}>Operations Console</div>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => pendingNavigate ? pendingNavigate(id) : setView(id)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', background: view === id ? T.cream : 'transparent',
            border: 'none', borderRadius: 8, color: view === id ? T.ink : T.muted,
            fontSize: 13.5, fontWeight: view === id ? 500 : 400, cursor: 'pointer', textAlign: 'left'
          }}>
            <Icon size={16} strokeWidth={1.75} /> {label}
          </button>
        ))}
      </nav>
      <div style={{ position: 'absolute', bottom: 18, left: 14, right: 14, padding: 12, background: T.cream, borderRadius: 10, fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
        <div style={{ color: T.ink, fontWeight: 500, fontSize: 12, marginBottom: 4 }}>Local data, your control</div>
        Use Export to sync to Google Sheets.
      </div>
    </aside>
  );
}


function Header({ view, stats, company, currentCompany, setCurrentCompany }) {
  const titles = {
    dashboard: { title: 'Dashboard', sub: 'Your business at a glance' },
    orders: { title: 'Orders', sub: `${stats.totalOrders} total · ${stats.activeOrders} active` },
    new: { title: 'New Order', sub: 'Enter customer and product details' },
    expenses: { title: 'Expenses', sub: 'Track costs across Malaysia and Bangladesh' },
    books: { title: 'Books & Ledger', sub: 'Bank balance, loans, payables, receivables' },
    invoices: { title: 'Sales Invoice', sub: 'A4-ready invoices with barcode' },
    receipts: { title: 'Paid Receipts', sub: 'Confirmations of completed orders' },
    export: { title: 'Export & Sync', sub: 'Back up your data to Google Sheets' },
    postmaker: { title: 'Post Maker', sub: 'Create projects and generate product images' }
  };
  const t = titles[view] || titles.dashboard;

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
}

function CompanySwitcher({ current, setCurrent }) {
  const [open, setOpen] = useState(false);
  const co = COMPANIES[current];
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
        cursor: 'pointer', fontFamily: T.sans
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: co.accent }} />
        <span style={{ fontWeight: 500, fontSize: 14, color: T.ink }}>{co.displayName}</span>
        <ChevronDown size={14} color={T.muted} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10,
            boxShadow: '0 10px 40px rgba(0,0,0,0.1)', minWidth: 220, zIndex: 50, overflow: 'hidden'
          }}>
            {Object.values(COMPANIES).map(c => (
              <button key={c.id} onClick={() => { setCurrent(c.id); setOpen(false); }} style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 16px',
                background: current === c.id ? T.cream : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left'
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.accent }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, color: T.ink }}>{c.displayName}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{c.address}</div>
                </div>
                {current === c.id && <Check size={14} color={T.success} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════
function Dashboard({ stats, orders, loans, accounts, ledger, onOpenOrder }) {
  const recentOrders = orders.slice(0, 5);
  const profit = stats.netProfit;
  const balances = accounts.reduce((acc, a) => {
    const movements = ledger
      .filter(l => l.account === a.name && (l.currency || 'BDT') === (a.currency || 'BDT'))
      .reduce((sum, l) => sum + (l.direction === 'in' ? parseFloat(l.amount) : -parseFloat(l.amount)), 0);
    const bal = (parseFloat(a.openingBalance) || 0) + movements;
    if ((a.currency || 'BDT') === 'RM') acc.rm += bal;
    else acc.bdt += bal;
    return acc;
  }, { bdt: 0, rm: 0 });

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
        <MetricCard label="Total Revenue" value={fmtBDT(stats.totalRevenue)} sub={`${orders.filter(o => o.status === 'delivered').length} delivered`} icon={TrendingUp} accent={T.emerald} grad="linear-gradient(135deg,#30D158,#00C7BE)" big />
        <MetricCard label="COGS" value={fmtBDT(stats.deliveredCOGS)} sub="Cost of delivered goods" icon={Package} accent={T.amber} grad="linear-gradient(135deg,#FF9F0A,#FF6B6B)" />
        <MetricCard label="Net Profit" value={fmtBDT(profit)} sub={profit >= 0 ? 'Revenue − COGS − expenses' : 'Review costs'} icon={Wallet} accent={profit >= 0 ? T.emerald : T.paidRed} grad={profit >= 0 ? "linear-gradient(135deg,#30D158,#5AC8FA)" : "linear-gradient(135deg,#FF2D55,#FF9F0A)"} big />
        <MetricCard label="Bank Balance" value={fmtBDT(balances.bdt)} sub={balances.rm > 0 ? `+ ${fmtRM(balances.rm)} · ${accounts.length} accounts` : `${accounts.length} accounts`} icon={Landmark} accent={T.blue} grad="linear-gradient(135deg,#0A84FF,#32ADE6)" />
        <MetricCard label="Payable" value={fmtBDT(stats.totalPayable)} sub="You owe" icon={ArrowDownRight} accent={T.rose} grad="linear-gradient(135deg,#FF2D55,#FF9F0A)" />
        <MetricCard label="Receivable" value={fmtBDT(stats.totalReceivable)} sub="Owed to you" icon={ArrowUpRight} accent={T.indigo} grad="linear-gradient(135deg,#5E5CE6,#BF5AF2)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="pcg-card" style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', bottom: -40, right: -40, width: 150, height: 150, borderRadius: '50%', background: 'radial-gradient(circle,rgba(94,92,230,0.07) 0%,transparent 70%)', pointerEvents: 'none' }} />
          <h3 style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: 16, margin: '0 0 18px', fontWeight: 800, color: T.ink, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: T.indigo }} />
            Order Pipeline
          </h3>
          {STATUS_ORDER.map((key, i) => {
            const count = orders.filter(o => o.status === key).length;
            const s = STATUS[key];
            const pct = orders.length ? Math.round((count / orders.length) * 100) : 0;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: i < STATUS_ORDER.length - 1 ? `1px solid ${T.borderSoft}` : 'none' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 13, color: T.inkSoft, fontWeight: 500 }}>{s.label}</div>
                {pct > 0 && <div style={{ width: 50, height: 5, background: '#F5EFEB', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: s.color, borderRadius: 10 }} />
                </div>}
                <div style={{ fontSize: 17, fontFamily: "'Times New Roman', Times, serif", fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: count > 0 ? T.ink : T.muted, minWidth: 24, textAlign: 'right' }}>{count}</div>
              </div>
            );
          })}
        </div>

        <div className="pcg-card">
          <h3 style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: 16, margin: '0 0 18px', fontWeight: 800, color: T.ink, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: T.amber }} />
            Open Loans Summary
          </h3>
          {loans.filter(l => l.status === 'open').length === 0 ? (
            <EmptyState text="No open loans." />
          ) : (
            <div>
              {loans.filter(l => l.status === 'open').slice(0, 5).map(l => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${T.borderSoft}` }}>
                  <div style={{ padding: '4px 10px', background: l.type === 'taken' ? '#FFF3CD' : '#D1FAE5', color: l.type === 'taken' ? '#92400E' : '#065F46', borderRadius: 20, fontSize: 10.5, fontWeight: 700, fontFamily: "'Times New Roman', Times, serif", textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {l.type === 'taken' ? 'Payable' : 'Receivable'}
                  </div>
                  <div style={{ flex: 1, fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{l.party}</div>
                  <div style={{ fontFamily: "'Times New Roman', Times, serif", fontWeight: 800, fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>{fmtMoney(l.principal - (l.amountRepaid || 0), l.currency)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="pcg-card" style={{ marginTop: 16, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,85,51,0.06) 0%,transparent 70%)', pointerEvents: 'none' }} />
        <h3 style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: 16, margin: '0 0 16px', fontWeight: 800, color: T.ink, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: T.terracotta }} />
          Recent Orders
        </h3>
        {recentOrders.length === 0 ? <EmptyState text="No orders yet." /> : (
          <div>{recentOrders.map(o => <MiniOrderRow key={o.id} order={o} onClick={() => onOpenOrder(o)} />)}</div>
        )}
      </div>
    </div>
  );
}

function MiniOrderRow({ order, onClick }) {
  const c = calcOrder(order);
  const s = STATUS[order.status];
  return (
    <div className="pcg-row" onClick={onClick} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: 8, marginBottom: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: s.color }} />
        <div>
          <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{order.customerName} <span style={{ color: T.muted, fontWeight: 400 }}>· {order.orderNumber}</span></div>
          <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{order.productName} · {fmtDateShort(order.orderDate)}</div>
        </div>
      </div>
      <div style={{ fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 15 }}>{fmtBDT(c.selling)}</div>
    </div>
  );
}

function MetricCard({ label, value, sub, icon: Icon, accent, big }) {
  return (
    <div className="pcg-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>{label}</div>
        <Icon size={16} color={accent} strokeWidth={1.75} />
      </div>
      <div style={{ fontFamily: T.serif, fontSize: big ? 28 : 23, fontWeight: 500, letterSpacing: '-0.02em', color: T.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: T.muted, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ORDERS LIST
// ═══════════════════════════════════════════════════════════════════
function Orders({ orders, invoices, accounts, ledger, company, onOpenOrder, onNew, onUpdateOrder, onRequirePayment, onRemovePayment, onShowInvoice, onShowReceipt, copyText }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState('');

  const filtered = useMemo(() => orders.filter(o => {
    if (filter !== 'all' && o.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return o.customerName?.toLowerCase().includes(q) || o.productName?.toLowerCase().includes(q) || o.orderNumber?.toLowerCase().includes(q) || o.customerPhone?.toLowerCase().includes(q);
    }
    return true;
  }), [orders, search, filter]);

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(o => o.id)));
  };

  // Apply a status to one order, casting cascade like the modal does
  const applyStatusToOrder = (order, newStatus) => {
    // For paid statuses, route through the payment prompt the same way checkpoints do
    if (newStatus === 'advance_paid' && !order.advancePaid) {
      onRequirePayment(order, 'order_advance');
      return;
    }
    if (newStatus === 'delivered' && !order.delivered) {
      onRequirePayment(order, 'order_final');
      return;
    }
    // Otherwise just cascade the booleans
    const flags = {
      pending: { advancePaid: false, orderPlacedMY: false, reachedBD: false, onTheWay: false, delivered: false },
      advance_paid: { advancePaid: true, orderPlacedMY: false, reachedBD: false, onTheWay: false, delivered: false },
      order_confirmed: { advancePaid: true, orderPlacedMY: true, reachedBD: false, onTheWay: false, delivered: false },
      reached_bd: { advancePaid: true, orderPlacedMY: true, reachedBD: true, onTheWay: false, delivered: false },
      on_the_way: { advancePaid: true, orderPlacedMY: true, reachedBD: true, onTheWay: true, delivered: false },
      delivered: { advancePaid: true, orderPlacedMY: true, reachedBD: true, onTheWay: true, delivered: true },
      cancelled: { advancePaid: false, orderPlacedMY: false, reachedBD: false, onTheWay: false, delivered: false }
    };
    // If un-cascading past a payment checkpoint, remove its ledger entry
    if (!flags[newStatus].advancePaid && order.advancePaid) onRemovePayment(order.id, 'order_advance');
    if (!flags[newStatus].delivered && order.delivered) onRemovePayment(order.id, 'order_final');
    onUpdateOrder(order.id, flags[newStatus]);
  };

  const applyBulkStatus = () => {
    if (!bulkStatus || selected.size === 0) return;
    const willPrompt = bulkStatus === 'advance_paid' || bulkStatus === 'delivered';
    if (willPrompt) {
      alert(`"${STATUS[bulkStatus].label}" requires per-order payment entry. Please update those one at a time so each payment is recorded correctly.`);
      return;
    }
    if (!confirm(`Apply "${STATUS[bulkStatus].label}" to ${selected.size} order${selected.size !== 1 ? 's' : ''}?`)) return;
    filtered.forEach(o => {
      if (selected.has(o.id)) applyStatusToOrder(o, bulkStatus);
    });
    setSelected(new Set());
    setBulkStatus('');
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 340, minWidth: 220 }}>
          <Search size={15} color={T.muted} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
          <input className="pcg-input" placeholder="Search by name, phone, product, order#" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40, borderRadius: 14 }} />
        </div>
        <select className="pcg-input" value={filter} onChange={e => setFilter(e.target.value)} style={{ maxWidth: 185, borderRadius: 14 }}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button className="pcg-btn" onClick={onNew} style={{ marginLeft: 'auto', borderRadius: 14 }}><Plus size={16} /> New Order</button>
      </div>

      {/* Bulk action bar — shows only when items are selected */}
      {selected.size > 0 && (
        <div className="fade-in" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: T.ink, color: T.cream, borderRadius: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{selected.size} order{selected.size !== 1 ? 's' : ''} selected</div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} style={{ padding: '8px 10px', background: T.surface, color: T.ink, border: 'none', borderRadius: 6, fontSize: 13, minWidth: 180 }}>
              <option value="">Change status to…</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button onClick={applyBulkStatus} disabled={!bulkStatus} className="pcg-btn" style={{ background: T.terracotta }}>Apply</button>
            <button onClick={() => setSelected(new Set())} className="pcg-btn pcg-btn-ghost" style={{ color: T.cream }}>Clear</button>
          </div>
        </div>
      )}

      <div className="pcg-card" style={{ padding: 0, overflow: 'visible' }}>
        {filtered.length === 0 ? <div style={{ padding: 36 }}><EmptyState text={orders.length === 0 ? "No orders yet. Click 'New Order' to start." : "No orders match your filters."} /></div> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '40px 100px 1fr 1fr 110px 160px 50px 50px 40px', padding: '12px 16px', borderBottom: `1px solid ${T.borderSoft}`, fontSize: 10.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, alignItems: 'center', gap: 8 }}>
              <div>
                <input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={toggleSelectAll} style={{ cursor: 'pointer', accentColor: T.terracotta }} />
              </div>
              <div>Order #</div>
              <div>Customer</div>
              <div>Product</div>
              <div>Total</div>
              <div>Status</div>
              <div title="Message">Msg</div>
              <div title="Invoice / Receipt">Doc</div>
              <div></div>
            </div>
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
          </>
        )}
      </div>
    </div>
  );
}

function OrderRow({ order, invoices, ledger, company, isSelected, onToggleSelect, onStatusChange, onShowInvoice, onShowReceipt, onOpen, copyText }) {
  const c = calcOrder(order);
  const s = STATUS[order.status];
  const linkedInvoice = (invoices || []).find(inv => inv.relatedOrderId === order.id);
  const linkedPayments = (ledger || []).filter(l => l.relatedOrderId === order.id && l.direction === 'in' && l.kind !== 'cogs');

  const [msgOpen, setMsgOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);

  // Which messages are available based on order stage
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
    <div style={{ display: 'grid', gridTemplateColumns: '40px 100px 1fr 1fr 110px 160px 50px 50px 40px', padding: '14px 16px', borderBottom: `1px solid ${T.borderSoft}`, alignItems: 'center', fontSize: 13.5, gap: 8, position: 'relative', background: isSelected ? T.terracotta + '08' : 'transparent' }}>
      <div>
        <input type="checkbox" checked={isSelected} onChange={onToggleSelect} style={{ cursor: 'pointer', accentColor: T.terracotta }} />
      </div>
      <div onClick={onOpen} style={{ cursor: 'pointer', fontFamily: T.serif, fontWeight: 500 }}>{order.orderNumber}</div>
      <div onClick={onOpen} style={{ cursor: 'pointer' }}>
        <div style={{ color: T.ink, fontWeight: 500 }}>{order.customerName}</div>
        <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{order.customerPhone}</div>
      </div>
      <div onClick={onOpen} style={{ cursor: 'pointer' }}>
        <div style={{ color: T.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.productName}</div>
        <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{fmtDate(order.orderDate)}</div>
      </div>
      <div onClick={onOpen} style={{ cursor: 'pointer', fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{fmtBDT(c.selling)}</div>

      {/* Inline status dropdown */}
      <div onClick={e => e.stopPropagation()}>
        <select
          value={order.status}
          onChange={e => onStatusChange(e.target.value)}
          style={{
            width: '100%', padding: '5px 6px', fontSize: 11.5, fontWeight: 700,
            background: s.bg, color: s.color, border: `1.5px solid ${s.color}40`,
            borderRadius: 6, cursor: 'pointer', appearance: 'menulist',
            letterSpacing: '0.02em'
          }}
        >
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k} style={{ background: T.surface, color: T.ink }}>{v.label}</option>)}
        </select>
      </div>

      {/* Message column — dropdown of templated messages to copy */}
      <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
        <button onClick={() => { setMsgOpen(!msgOpen); setDocOpen(false); }} className="pcg-btn pcg-btn-ghost" title="Copy message" style={{ padding: 4 }}>
          <MessageSquare size={15} />
        </button>
        {msgOpen && (
          <>
            <div onClick={() => setMsgOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', minWidth: 220, zIndex: 50, overflow: 'hidden' }}>
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

      {/* Doc column — picker for invoice / paid receipt */}
      <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
        <button onClick={() => { setDocOpen(!docOpen); setMsgOpen(false); }} className="pcg-btn pcg-btn-ghost" title="Print invoice or receipt" style={{ padding: 4 }}>
          <FileText size={15} />
        </button>
        {docOpen && (
          <>
            <div onClick={() => setDocOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', minWidth: 220, zIndex: 50, overflow: 'hidden' }}>
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

      <div onClick={onOpen} style={{ cursor: 'pointer', textAlign: 'right' }}><ChevronRight size={15} color={T.muted} /></div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NEW ORDER (multi-item, editable multiplier)
// ═══════════════════════════════════════════════════════════════════
function NewOrder({ onSubmit, onCancel, defaultRate }) {
  const [form, setForm] = useState({
    customerName: '', customerPhone: '', customerAddress: '', customerFb: '',
    items: [{ id: uid(), productName: '', productDescription: '', costRM: '', qty: 1, priceMode: 'multiplier', multiplier: COST_MULTIPLIER, sellingBDT: '' }],
    multiplier: COST_MULTIPLIER,
    conversionRate: defaultRate || 25,
    discountType: 'none', discountValue: '',
    notes: '',
    skipAdvance: false
  });

  // Feed the live calc with the full item shape so per-item pricing works
  const orderForCalc = useMemo(() => ({
    items: form.items.map(it => ({
      costRM: it.costRM, qty: it.qty,
      priceMode: it.priceMode,
      multiplier: it.multiplier,
      sellingBDT: it.sellingBDT
    })),
    multiplier: form.multiplier,
    discountType: form.discountType,
    discountValue: form.discountValue
  }), [form.items, form.multiplier, form.discountType, form.discountValue]);
  const calc = useMemo(() => calcOrder(orderForCalc), [orderForCalc]);

  const addItem = () => setForm({
    ...form,
    items: [...form.items, { id: uid(), productName: '', productDescription: '', costRM: '', qty: 1, priceMode: 'multiplier', multiplier: form.multiplier, sellingBDT: '' }]
  });
  const updateItem = (id, key, value) => setForm({
    ...form,
    items: form.items.map(it => it.id === id ? { ...it, [key]: value } : it)
  });
  const removeItem = (id) => {
    if (form.items.length === 1) return;
    setForm({ ...form, items: form.items.filter(it => it.id !== id) });
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.customerName) return alert('Customer name is required.');
    // Valid = has a name AND (a cost price OR a fixed selling price)
    const validItems = form.items.filter(it => it.productName && (it.costRM || (it.priceMode === 'fixed' && it.sellingBDT)));
    if (validItems.length === 0) return alert('Add at least one item with a product name and a price.');

    const cleanItems = validItems.map(it => ({
      id: it.id,
      productName: it.productName,
      productDescription: it.productDescription || '',
      costRM: parseFloat(it.costRM) || 0,
      qty: parseFloat(it.qty) || 1,
      priceMode: it.priceMode || 'multiplier',
      multiplier: parseFloat(it.multiplier) || parseFloat(form.multiplier) || COST_MULTIPLIER,
      sellingBDT: parseFloat(it.sellingBDT) || 0
    }));

    const totalCostRM = cleanItems.reduce((s, it) => s + (it.costRM * it.qty), 0);
    const conversionRate = parseFloat(form.conversionRate) || 0;
    const cogsBDT = totalCostRM * conversionRate;

    const payload = {
      customerName: form.customerName,
      customerPhone: form.customerPhone,
      customerAddress: form.customerAddress,
      customerFb: form.customerFb,
      items: cleanItems,
      multiplier: parseFloat(form.multiplier) || COST_MULTIPLIER,
      conversionRate,
      cogsBDT,
      discountType: form.discountType,
      discountValue: parseFloat(form.discountValue) || 0,
      productName: cleanItems.length === 1
        ? cleanItems[0].productName
        : `${cleanItems.length} items (${cleanItems[0].productName}${cleanItems.length > 1 ? ' + more' : ''})`,
      productDescription: cleanItems.map(it => `${it.qty}× ${it.productName}${it.productDescription ? ` (${it.productDescription})` : ''}`).join(' · '),
      costPriceRM: totalCostRM,
      notes: form.notes,
      skipAdvance: form.skipAdvance
    };
    onSubmit(payload);
  };

  return (
    <form onSubmit={submit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 18 }}>
        <div className="pcg-card">
          <h3 style={{ fontFamily: T.serif, fontSize: 18, margin: '0 0 20px', fontWeight: 500 }}>Customer & Products</h3>

          <Section title="Customer Info">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Full Name *"><input className="pcg-input" value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} placeholder="e.g. Ayesha Rahman" /></Field>
              <Field label="Phone Number"><input className="pcg-input" value={form.customerPhone} onChange={e => setForm({ ...form, customerPhone: e.target.value })} placeholder="+880 17..." /></Field>
            </div>
            <Field label="Delivery Address" style={{ marginTop: 12 }}><input className="pcg-input" value={form.customerAddress} onChange={e => setForm({ ...form, customerAddress: e.target.value })} placeholder="House / Road / Area / City" /></Field>
            <Field label="Facebook (optional)" style={{ marginTop: 12 }}><input className="pcg-input" value={form.customerFb} onChange={e => setForm({ ...form, customerFb: e.target.value })} placeholder="fb.com/..." /></Field>
          </Section>

          <Section title="Items in this Order">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {form.items.map((item, idx) => {
                const r = calcItemSelling(item, form.multiplier);
                return (
                  <div key={item.id} style={{ padding: 14, background: T.surface, border: `1px solid ${T.borderSoft}`, borderRadius: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Item {idx + 1}</div>
                      {form.items.length > 1 && (
                        <button type="button" onClick={() => removeItem(item.id)} className="pcg-btn pcg-btn-ghost pcg-btn-sm" style={{ color: T.terracotta }}>
                          <Trash2 size={12} /> Remove
                        </button>
                      )}
                    </div>
                    <Field label="Product Name *"><input className="pcg-input" value={item.productName} onChange={e => updateItem(item.id, 'productName', e.target.value)} placeholder="e.g. Uniqlo Airism T-Shirt (Black, M)" /></Field>
                    <Field label="Description / Variant" style={{ marginTop: 10 }}>
                      <input className="pcg-input" value={item.productDescription} onChange={e => updateItem(item.id, 'productDescription', e.target.value)} placeholder="e.g. Size M, Black" />
                    </Field>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 10, marginTop: 10 }}>
                      <Field label="Cost Price (RM)">
                        <input className="pcg-input" type="number" step="0.01" min="0" value={item.costRM} onChange={e => updateItem(item.id, 'costRM', e.target.value)} placeholder="0.00" />
                      </Field>
                      <Field label="Qty">
                        <input className="pcg-input" type="number" min="1" step="1" value={item.qty} onChange={e => updateItem(item.id, 'qty', e.target.value)} />
                      </Field>
                    </div>

                    {/* Pricing mode toggle */}
                    <div style={{ marginTop: 12 }}>
                      <label className="pcg-label">How to price this item?</label>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                        <button type="button" onClick={() => updateItem(item.id, 'priceMode', 'multiplier')} style={priceModeBtn(item.priceMode !== 'fixed')}>
                          By Multiplier
                        </button>
                        <button type="button" onClick={() => updateItem(item.id, 'priceMode', 'fixed')} style={priceModeBtn(item.priceMode === 'fixed')}>
                          Set Selling Price
                        </button>
                      </div>

                      {item.priceMode === 'fixed' ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
                          <Field label="Selling Price each (BDT)">
                            <input className="pcg-input" type="number" step="0.01" min="0" value={item.sellingBDT} onChange={e => updateItem(item.id, 'sellingBDT', e.target.value)} placeholder="0" />
                          </Field>
                          <div>
                            <label className="pcg-label">Line Total (BDT)</label>
                            <div style={priceBox}>{fmtBDT(r.lineSelling)}</div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'end' }}>
                          <Field label="Multiplier (×)">
                            <input className="pcg-input" type="number" step="0.5" min="1" value={item.multiplier} onChange={e => updateItem(item.id, 'multiplier', e.target.value)} placeholder={String(COST_MULTIPLIER)} />
                          </Field>
                          <div>
                            <label className="pcg-label">Line Total (BDT)</label>
                            <div style={priceBox}>{fmtBDT(r.lineSelling)}</div>
                          </div>
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>
                        {item.priceMode === 'fixed'
                          ? `Fixed price. Cost RM ${item.costRM || 0} is kept for your profit records only.`
                          : `Selling each = RM ${item.costRM || 0} × ${item.multiplier || form.multiplier} = ${fmtBDT(r.sellingEach)}`}
                      </div>
                    </div>
                  </div>
                );
              })}
              <button type="button" onClick={addItem} className="pcg-btn pcg-btn-secondary" style={{ alignSelf: 'flex-start' }}>
                <Plus size={13} /> Add Another Item
              </button>
            </div>
          </Section>

          <Section title="Default Multiplier">
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 14, alignItems: 'center' }}>
              <Field label="Cost × Multiplier">
                <input className="pcg-input" type="number" step="0.5" min="1" value={form.multiplier} onChange={e => setForm({ ...form, multiplier: e.target.value })} style={{ fontFamily: T.serif, fontSize: 17 }} />
              </Field>
              <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
                Default is <strong style={{ color: T.ink }}>×{COST_MULTIPLIER}</strong>. New items start with this multiplier, but each item can override it above or switch to a fixed selling price.
              </div>
            </div>
          </Section>

          <Section title="Cost of Goods (COGS)">
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 14, alignItems: 'center' }}>
              <Field label="RM → BDT Rate (real)">
                <input className="pcg-input" type="number" step="0.01" min="0" value={form.conversionRate} onChange={e => setForm({ ...form, conversionRate: e.target.value })} style={{ fontFamily: T.serif, fontSize: 17 }} />
              </Field>
              <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
                The <strong style={{ color: T.ink }}>real rate</strong> you pay to convert RM to BDT (not the selling multiplier). This turns your RM cost into a Cost of Goods Sold entry in the books, so the dashboard shows true profit.
              </div>
            </div>
            <div style={{ marginTop: 12, padding: 12, background: T.terracotta + '0E', border: `1px solid ${T.terracotta}25`, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12.5, color: T.inkSoft }}>
                Total COGS for this order
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{fmtRM(calc.cost)} × {form.conversionRate || 0} rate</div>
              </div>
              <div style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 600, color: T.terracotta, fontVariantNumeric: 'tabular-nums' }}>
                {fmtBDT(calc.cost * (parseFloat(form.conversionRate) || 0))}
              </div>
            </div>
          </Section>

          <Section title="Discount">
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {[
                { id: 'none', label: 'No Discount' },
                { id: 'percent', label: 'Percentage %' },
                { id: 'amount', label: 'Fixed Amount' }
              ].map(opt => (
                <button key={opt.id} type="button" onClick={() => setForm({ ...form, discountType: opt.id })} style={priceModeBtn(form.discountType === opt.id)}>
                  {opt.label}
                </button>
              ))}
            </div>
            {form.discountType !== 'none' && (
              <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 14, alignItems: 'end' }}>
                <Field label={form.discountType === 'percent' ? 'Discount %' : 'Discount Amount (BDT)'}>
                  <input className="pcg-input" type="number" step="0.01" min="0" value={form.discountValue} onChange={e => setForm({ ...form, discountValue: e.target.value })} placeholder="0" style={{ fontFamily: T.serif, fontSize: 16 }} />
                </Field>
                <div style={{ fontSize: 12.5, color: T.muted }}>
                  {form.discountValue ? <>You're giving <strong style={{ color: T.terracotta }}>{fmtBDT(calc.discountAmount)}</strong> off the {fmtBDT(calc.grossSelling)} subtotal.</> : 'Enter a value to apply the discount.'}
                </div>
              </div>
            )}
          </Section>

          <Section title="Payment Terms" last>
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12,
              background: form.skipAdvance ? T.warning + '12' : T.surface,
              border: `1px solid ${form.skipAdvance ? T.warning + '40' : T.border}`,
              borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s'
            }}>
              <input
                type="checkbox"
                checked={form.skipAdvance}
                onChange={e => setForm({ ...form, skipAdvance: e.target.checked })}
                style={{ marginTop: 2, accentColor: T.warning }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>Skip advance payment (trust order)</div>
                <div style={{ fontSize: 11.5, color: T.muted, marginTop: 3, lineHeight: 1.5 }}>
                  {form.skipAdvance
                    ? `Customer pays the full ${fmtBDT(calc.selling)} on delivery. We absorb the risk if they cancel — only check this for trusted customers.`
                    : 'Standard 40% advance required before we place the order in Malaysia.'}
                </div>
              </div>
            </label>
          </Section>

          <Field label="Internal Notes" style={{ marginTop: 16 }}><textarea className="pcg-input" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={{ resize: 'vertical' }} /></Field>
          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <button type="button" className="pcg-btn pcg-btn-secondary" onClick={onCancel}>Cancel</button>
            <button type="submit" className="pcg-btn">Create Order & Invoice <ChevronRight size={14} /></button>
            <button
              type="button"
              className="pcg-btn"
              style={{ background: T.terracotta }}
              onClick={() => {
                // Manually fire submit with printAfter flag set
                if (!form.customerName) return alert('Customer name is required.');
                const validItems = form.items.filter(it => it.productName && (it.costRM || (it.priceMode === 'fixed' && it.sellingBDT)));
                if (validItems.length === 0) return alert('Add at least one item with a product name and a price.');
                const cleanItems = validItems.map(it => ({
                  id: it.id,
                  productName: it.productName,
                  productDescription: it.productDescription || '',
                  costRM: parseFloat(it.costRM) || 0,
                  qty: parseFloat(it.qty) || 1,
                  priceMode: it.priceMode || 'multiplier',
                  multiplier: parseFloat(it.multiplier) || parseFloat(form.multiplier) || COST_MULTIPLIER,
                  sellingBDT: parseFloat(it.sellingBDT) || 0
                }));
                const totalCostRM = cleanItems.reduce((s, it) => s + (it.costRM * it.qty), 0);
                const conversionRate = parseFloat(form.conversionRate) || 0;
                onSubmit({
                  customerName: form.customerName,
                  customerPhone: form.customerPhone,
                  customerAddress: form.customerAddress,
                  customerFb: form.customerFb,
                  items: cleanItems,
                  multiplier: parseFloat(form.multiplier) || COST_MULTIPLIER,
                  conversionRate,
                  cogsBDT: totalCostRM * conversionRate,
                  discountType: form.discountType,
                  discountValue: parseFloat(form.discountValue) || 0,
                  productName: cleanItems.length === 1 ? cleanItems[0].productName : `${cleanItems.length} items (${cleanItems[0].productName}${cleanItems.length > 1 ? ' + more' : ''})`,
                  productDescription: cleanItems.map(it => `${it.qty}× ${it.productName}${it.productDescription ? ` (${it.productDescription})` : ''}`).join(' · '),
                  costPriceRM: totalCostRM,
                  notes: form.notes,
                  skipAdvance: form.skipAdvance,
                  printAfter: true
                });
              }}
            >
              <Printer size={14} /> Create & Print Invoice
            </button>
            <button
              type="button"
              className="pcg-btn"
              style={{ background: '#0A7EA4' }}
              title="Print this form for your records"
              onClick={() => window.print()}
            >
              <Printer size={14} /> Print This Page
            </button>
          </div>
        </div>

        <div>
          <div style={{ position: 'sticky', top: 20, background: 'linear-gradient(160deg, #1a0800 0%, #0D0D0D 50%, #080012 100%)', borderRadius: 20, padding: 22, color: '#fff', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
            {/* Blobs */}
            <div style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,85,51,0.2) 0%,transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: -30, left: -30, width: 120, height: 120, borderRadius: '50%', background: 'radial-gradient(circle,rgba(94,92,230,0.15) 0%,transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.16em', fontWeight: 700, fontFamily: "'Times New Roman', Times, serif", marginBottom: 10 }}>Live Calculation</div>
              <div style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 4px', fontVariantNumeric: 'tabular-nums', background: 'linear-gradient(135deg,#FF9F0A,#FF5533,#FF375F)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{fmtBDT(calc.selling)}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>Final Price · {form.items.filter(it => it.productName && (it.costRM || it.sellingBDT)).length} item{form.items.filter(it => it.productName && (it.costRM || it.sellingBDT)).length !== 1 ? 's' : ''}</div>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '16px 0' }} />
              <PreviewRow label="Total Cost (RM)" value={fmtRM(calc.cost)} />
              <PreviewRow label="Subtotal" value={fmtBDT(calc.grossSelling)} />
              {calc.discountAmount > 0 && (
                <PreviewRow label={`Discount${calc.discountType === 'percent' ? ` (${calc.discountValue}%)` : ''}`} value={`− ${fmtBDT(calc.discountAmount)}`} muted />
              )}
              <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '12px 0' }} />
              {(() => {
                const cogs = calc.cost * (parseFloat(form.conversionRate) || 0);
                const profit = calc.selling - cogs;
                return (
                  <>
                    <PreviewRow label="COGS (BDT)" value={`− ${fmtBDT(cogs)}`} muted />
                    <PreviewRow label="Projected Profit" value={fmtBDT(profit)} bold />
                  </>
                );
              })()}
              <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '12px 0' }} />
              {form.skipAdvance ? (
                <>
                  <PreviewRow label="Advance Required" value="None (trust order)" muted />
                  <PreviewRow label="Due on delivery" value={fmtBDT(calc.selling)} bold />
                  <PreviewRow label="Due via bKash" value={fmtBDT(calc.selling * (1 + BKASH_FEE_PERCENT))} muted />
                </>
              ) : (
                <>
                  <PreviewRow label="Advance (40%)" value={fmtBDT(calc.advance)} bold />
                  <PreviewRow label="Via bKash (+2%)" value={fmtBDT(calc.advanceBkash)} muted />
                  <PreviewRow label="Due on delivery" value={fmtBDT(calc.due)} bold />
                  <PreviewRow label="Due via bKash" value={fmtBDT(calc.dueBkash)} muted />
                </>
              )}
              <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '14px 0 12px' }} />
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, fontFamily: "'Times New Roman', Times, serif", marginBottom: 10 }}>Auto-generated</div>
              {[
                'Order entry created',
                'Invoice with QR generated',
                'Ready to print on A4'
              ].map((txt, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>
                  <div style={{ width: 18, height: 18, borderRadius: 6, background: 'rgba(48,209,88,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Check size={10} color="#30D158" strokeWidth={3} />
                  </div>
                  {txt}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

const priceModeBtn = (active) => ({
  flex: 1, padding: '9px 12px', fontSize: 12.5, fontWeight: 700,
  fontFamily: "'Times New Roman', Times, serif",
  background: active ? 'linear-gradient(135deg,#FF5533,#FF375F)' : '#fff',
  color: active ? '#fff' : T.muted,
  border: active ? 'none' : `1.5px solid ${T.border}`,
  borderRadius: 10, cursor: 'pointer',
  transition: 'all 0.18s',
  boxShadow: active ? '0 4px 12px rgba(255,85,51,0.3)' : 'none'
});

const priceBox = {
  padding: '11px 15px', background: '#FFF8F5', border: `1.5px solid #EDE5E0`,
  borderRadius: 12, fontFamily: "'Times New Roman', Times, serif", fontSize: 16, fontWeight: 800,
  fontVariantNumeric: 'tabular-nums', color: T.terracotta
};

function Section({ title, children, last }) {
  return (
    <div style={{ paddingBottom: last ? 0 : 20, marginBottom: last ? 0 : 20, borderBottom: last ? 'none' : `1.5px solid ${T.borderSoft}` }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, fontFamily: "'Times New Roman', Times, serif", display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 14, height: 3, borderRadius: 2, background: T.terracotta }} />
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children, style }) {
  return <div style={style}><label className="pcg-label">{label}</label>{children}</div>;
}

function PreviewRow({ label, value, bold, muted }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: muted ? 12 : 13.5, color: muted ? T.cream + '88' : T.cream }}>
      <span>{label}</span>
      <span style={{ fontFamily: bold ? T.serif : T.sans, fontWeight: bold ? 500 : 400, fontSize: bold ? 16 : (muted ? 12 : 13.5), fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ORDER MODAL (with edit mode)
// ═══════════════════════════════════════════════════════════════════
function OrderModal({ order, company, accounts, onClose, onUpdate, onDelete, onShowMessage, onRequirePayment, onRemovePayment, ledger, invoices, onShowInvoice, onShowReceipt }) {
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState(order);
  useEffect(() => { setForm(order); }, [order]);

  const c = calcOrder(order);
  const s = STATUS[order.status];

  // Find the auto-generated invoice for this order
  const linkedInvoice = (invoices || []).find(inv => inv.relatedOrderId === order.id);

  // For trust orders (skipAdvance), the advance checkpoint becomes informational
  // and the "final" payment on delivery covers the full amount.
  const checkpoints = [
    {
      key: 'advancePaid',
      label: order.skipAdvance ? 'Advance — Skipped (trust order)' : 'Advance Payment Received',
      icon: Wallet, message: null,
      color: order.skipAdvance ? T.muted : T.warning,
      paymentKind: order.skipAdvance ? null : 'order_advance',
      skipped: order.skipAdvance
    },
    { key: 'orderPlacedMY', label: 'Order Placed in Malaysia', icon: ShoppingBag, message: 'confirmed', color: '#3A6FA1' },
    { key: 'reachedBD', label: 'Reached Bangladesh', icon: MapPin, message: 'reachedBD', color: '#6B4FA8' },
    { key: 'onTheWay', label: 'Out for Delivery', icon: Truck, message: 'outForDelivery', color: T.terracotta },
    { key: 'delivered', label: 'Delivered to Customer', icon: CheckCircle2, message: 'delivered', color: T.success, paymentKind: 'order_final' }
  ];

  // Linked payment entries for this order — ONLY money the customer paid in.
  // Excludes COGS (that's our purchase cost, not a customer payment).
  const linkedPayments = (ledger || []).filter(l => l.relatedOrderId === order.id && l.direction === 'in' && l.kind !== 'cogs');

  const toggleCheckpoint = (cp) => {
    const newValue = !order[cp.key];

    // If this checkpoint triggers a payment, route through the payment prompt
    if (newValue && cp.paymentKind) {
      onRequirePayment(order, cp.paymentKind);
      return;
    }

    const updates = { [cp.key]: newValue };
    if (newValue) {
      const idx = checkpoints.findIndex(x => x.key === cp.key);
      checkpoints.slice(0, idx).forEach(x => { updates[x.key] = true; });
    } else {
      const idx = checkpoints.findIndex(x => x.key === cp.key);
      checkpoints.slice(idx).forEach(x => {
        updates[x.key] = false;
        // Remove any linked payments when uncascading
        if (x.paymentKind) onRemovePayment(order.id, x.paymentKind);
      });
    }
    onUpdate(order.id, updates);
    if (newValue && cp.message) setTimeout(() => onShowMessage(cp.message), 300);
    else if (newValue && cp.key === 'advancePaid' && order.orderPlacedMY) setTimeout(() => onShowMessage('confirmed'), 300);
  };

  const saveEdits = () => {
    onUpdate(order.id, form);
    setEditMode(false);
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.45)', display: 'flex', justifyContent: 'flex-end', zIndex: 100, backdropFilter: 'blur(4px)' }}>
      <div onClick={e => e.stopPropagation()} className="fade-in" style={{ background: T.cream, width: '100%', maxWidth: 620, height: '100vh', overflowY: 'auto', boxShadow: '-20px 0 60px rgba(0,0,0,0.15)' }}>
        <div style={{ padding: '20px 28px', borderBottom: `1px solid ${T.border}`, background: T.surface, position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{order.orderNumber}</div>
              <h2 style={{ fontFamily: T.serif, fontSize: 24, margin: '6px 0 0', fontWeight: 500 }}>{order.customerName}</h2>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setEditMode(!editMode)} className="pcg-btn pcg-btn-ghost" title={editMode ? 'Cancel' : 'Edit'}>
                {editMode ? <X size={18} /> : <Pencil size={16} />}
              </button>
              <button onClick={onClose} className="pcg-btn pcg-btn-ghost"><X size={20} /></button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 5, background: s.bg, color: s.color, fontSize: 11, fontWeight: 600 }}>{s.label}</span>
            {order.skipAdvance && (
              <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 5, background: T.warning + '20', color: T.warning, fontSize: 11, fontWeight: 600 }}>
                TRUST ORDER · NO ADVANCE
              </span>
            )}
            {linkedInvoice && (
              <button onClick={() => onShowInvoice(linkedInvoice)} className="pcg-btn pcg-btn-ghost pcg-btn-sm" style={{ marginLeft: 'auto', color: T.terracotta }}>
                <FileText size={12} /> View Invoice {linkedInvoice.invoiceNumber}
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: '22px 28px' }}>
          {editMode ? (
            <div className="pcg-card" style={{ marginBottom: 20 }}>
              <h4 style={{ fontFamily: T.serif, fontSize: 16, margin: '0 0 14px', fontWeight: 500 }}>Edit Order Details</h4>
              <Field label="Customer Name"><input className="pcg-input" value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                <Field label="Phone"><input className="pcg-input" value={form.customerPhone || ''} onChange={e => setForm({ ...form, customerPhone: e.target.value })} /></Field>
                <Field label="Order Date"><input className="pcg-input" type="date" value={fmtDateInput(form.orderDate)} onChange={e => setForm({ ...form, orderDate: new Date(e.target.value).toISOString() })} /></Field>
              </div>
              <Field label="Product (summary)" style={{ marginTop: 12 }}><input className="pcg-input" value={form.productName} onChange={e => setForm({ ...form, productName: e.target.value })} /></Field>
              <Field label="Description" style={{ marginTop: 12 }}><textarea className="pcg-input" rows={2} value={form.productDescription || ''} onChange={e => setForm({ ...form, productDescription: e.target.value })} /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, marginTop: 12 }}>
                <Field label="Total Cost (RM)"><input className="pcg-input" type="number" step="0.01" value={form.costPriceRM} onChange={e => setForm({ ...form, costPriceRM: e.target.value })} /></Field>
                <Field label="Multiplier"><input className="pcg-input" type="number" step="0.5" min="1" value={form.multiplier || COST_MULTIPLIER} onChange={e => setForm({ ...form, multiplier: e.target.value })} /></Field>
              </div>
              {Array.isArray(order.items) && order.items.length > 1 && (
                <div style={{ marginTop: 8, padding: 10, background: T.cream, borderRadius: 8, fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>
                  This order has {order.items.length} items. Editing the total cost here adjusts the whole order. To edit individual items, delete and recreate the order.
                </div>
              )}
              <Field label="Notes" style={{ marginTop: 12 }}><textarea className="pcg-input" rows={2} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
              <button onClick={saveEdits} className="pcg-btn" style={{ marginTop: 16 }}><Save size={14} /> Save Changes</button>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
                <InfoBlock icon={Phone} label="Phone" value={order.customerPhone || '—'} />
                <InfoBlock icon={Calendar} label="Order Date" value={fmtDate(order.orderDate)} />
              </div>

              {/* Items list */}
              {Array.isArray(order.items) && order.items.length > 0 ? (
                <div className="pcg-card" style={{ marginBottom: 20, padding: 0 }}>
                  <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.borderSoft}`, fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                    Items ({order.items.length})
                  </div>
                  {order.items.map((it, idx) => {
                    const r = calcItemSelling(it, order.multiplier);
                    return (
                      <div key={it.id || idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', borderBottom: idx < order.items.length - 1 ? `1px solid ${T.borderSoft}` : 'none' }}>
                        <div style={{ width: 22, height: 22, borderRadius: '50%', background: T.cream, color: T.muted, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{idx + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{it.productName}</div>
                          {it.productDescription && <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{it.productDescription}</div>}
                          <div style={{ fontSize: 11.5, color: T.muted, marginTop: 3 }}>
                            {it.qty}× @ {fmtRM(it.costRM)} = {fmtRM(r.lineCost)}
                            {it.priceMode === 'fixed' ? ' · fixed price' : ` · ×${it.multiplier || order.multiplier || COST_MULTIPLIER}`}
                          </div>
                        </div>
                        <div style={{ fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 14, color: T.terracotta }}>{fmtBDT(r.lineSelling)}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ marginBottom: 20 }}>
                  <InfoBlock icon={Package} label="Product" value={order.productName} colSpan={2} />
                </div>
              )}

              <div className="pcg-card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                  <PriceStat label="Cost" value={fmtRM(c.cost)} />
                  <PriceStat label="Selling" value={fmtBDT(c.selling)} highlight />
                  <PriceStat label="Multiplier" value={`× ${c.multiplier}`} sub={c.multiplier === COST_MULTIPLIER ? 'default' : 'custom for this order'} />
                  <PriceStat label="Advance (40%)" value={fmtBDT(c.advance)} sub={`bKash: ${fmtBDT(c.advanceBkash)}`} />
                  <PriceStat label="Due on Delivery" value={fmtBDT(c.due)} sub={`bKash: ${fmtBDT(c.dueBkash)}`} />
                  <PriceStat label="Received" value={fmtBDT(order.advancePaid ? (order.delivered ? c.selling : c.advance) : 0)} />
                </div>
              </div>
            </>
          )}

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 }}>Order Pipeline</div>
            <div style={{ background: T.surface, borderRadius: 12, padding: '6px 0', border: `1px solid ${T.borderSoft}` }}>
              {checkpoints.map((cp, i) => {
                const done = order[cp.key];
                const Icon = cp.icon;
                return (
                  <div key={cp.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: i < checkpoints.length - 1 ? `1px solid ${T.borderSoft}` : 'none' }}>
                    <button onClick={() => toggleCheckpoint(cp)} style={{ width: 24, height: 24, borderRadius: '50%', background: done ? cp.color : 'transparent', border: done ? 'none' : `2px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
                      {done && <Check size={13} color="white" strokeWidth={3} />}
                    </button>
                    <Icon size={15} color={done ? cp.color : T.muted} strokeWidth={1.75} />
                    <div style={{ flex: 1, fontSize: 13.5, color: done ? T.ink : T.inkSoft, fontWeight: done ? 500 : 400 }}>{cp.label}</div>
                    {done && cp.message && <button onClick={() => onShowMessage(cp.message)} className="pcg-btn pcg-btn-ghost pcg-btn-sm"><MessageSquare size={12} /> Message</button>}
                  </div>
                );
              })}
            </div>
          </div>

          {linkedPayments.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 }}>Linked Payments in Ledger</div>
              <div style={{ background: T.surface, border: `1px solid ${T.borderSoft}`, borderRadius: 10, overflow: 'hidden' }}>
                {linkedPayments.map((p, i) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: i < linkedPayments.length - 1 ? `1px solid ${T.borderSoft}` : 'none' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: T.success }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: T.ink, fontWeight: 500 }}>{p.type}</div>
                      <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{fmtDate(p.date)} · {p.account}</div>
                    </div>
                    <div style={{ fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 14, color: T.success }}>+ {fmtBDT(p.amount)}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>These flow directly into your Books & Ledger. Unchecking a checkpoint removes its entry.</div>
            </div>
          )}

          {/* Print Paid Receipt — only after delivery */}
          {order.delivered && (
            <div style={{ marginBottom: 20, padding: 14, background: T.success + '0E', border: `1px solid ${T.success}30`, borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: T.success, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Check size={14} color="white" strokeWidth={3} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 600 }}>Order Delivered & Paid</div>
                  <div style={{ fontSize: 11.5, color: T.muted, marginTop: 1 }}>Generate a paid receipt for the customer with QR code, printable on POS.</div>
                </div>
              </div>
              <button
                onClick={() => onShowReceipt({ order, payments: linkedPayments, company })}
                className="pcg-btn"
                style={{ width: '100%', justifyContent: 'center', background: T.success }}
              >
                <Printer size={14} /> Print Paid Receipt
              </button>
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 }}>Quick Messages</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <MessageButton label="Advance Request" onClick={() => onShowMessage('advance')} />
              <MessageButton label="Order Confirmed" onClick={() => onShowMessage('confirmed')} />
              <MessageButton label="Reached Bangladesh" onClick={() => onShowMessage('reachedBD')} />
              <MessageButton label="Out for Delivery" onClick={() => onShowMessage('outForDelivery')} />
            </div>
          </div>

          {order.notes && !editMode && (
            <div style={{ padding: 14, background: T.surface, borderRadius: 10, border: `1px solid ${T.borderSoft}`, fontSize: 13, color: T.inkSoft, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontWeight: 600 }}>Notes</div>
              {order.notes}
            </div>
          )}

          <button onClick={() => onDelete(order.id)} className="pcg-btn pcg-btn-ghost" style={{ color: T.terracotta }}><Trash2 size={13} /> Delete order</button>
        </div>
      </div>
    </div>
  );
}

function InfoBlock({ icon: Icon, label, value, colSpan }) {
  return (
    <div style={{ background: T.surface, padding: '10px 12px', borderRadius: 10, border: `1px solid ${T.borderSoft}`, gridColumn: colSpan ? `span ${colSpan}` : 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <Icon size={11} color={T.muted} strokeWidth={1.75} />
        <div style={{ fontSize: 10.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>{label}</div>
      </div>
      <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function PriceStat({ label, value, sub, highlight }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: T.serif, fontSize: highlight ? 21 : 17, fontWeight: 500, color: highlight ? T.terracotta : T.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: T.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function MessageButton({ label, onClick }) {
  return <button onClick={onClick} className="pcg-btn pcg-btn-secondary" style={{ justifyContent: 'flex-start', padding: '10px 12px', fontSize: 12.5 }}><MessageSquare size={13} /> {label}</button>;
}

// ═══════════════════════════════════════════════════════════════════
// MESSAGE MODAL
// ═══════════════════════════════════════════════════════════════════
function MessageModal({ order, type, company, onClose, copyText }) {
  const text = messages[type] ? messages[type](order, company) : '';
  const titles = { advance: 'Advance Payment Request', confirmed: 'Order Confirmation', reachedBD: 'Reached Bangladesh + Due Payment', outForDelivery: 'Out for Delivery', delivered: 'Delivery Confirmation' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, backdropFilter: 'blur(6px)' }}>
      <div onClick={e => e.stopPropagation()} className="fade-in" style={{ background: T.cream, borderRadius: 16, width: '90%', maxWidth: 560, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Message Ready</div>
            <h3 style={{ fontFamily: T.serif, fontSize: 19, margin: '4px 0 0', fontWeight: 500 }}>{titles[type]}</h3>
          </div>
          <button onClick={onClose} className="pcg-btn pcg-btn-ghost"><X size={20} /></button>
        </div>
        <div style={{ padding: 22, overflowY: 'auto', flex: 1 }}>
          <div style={{ background: T.surface, border: `1px solid ${T.borderSoft}`, borderRadius: 10, padding: 16, fontSize: 13, lineHeight: 1.65, color: T.inkSoft, whiteSpace: 'pre-wrap', maxHeight: '50vh', overflowY: 'auto' }}>{text}</div>
        </div>
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${T.border}`, background: T.surface, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="pcg-btn pcg-btn-secondary">Close</button>
          <button onClick={() => { copyText(text, 'Message copied — paste in Messenger'); onClose(); }} className="pcg-btn"><Copy size={14} /> Copy to Clipboard</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EXPENSES (with edit)
// ═══════════════════════════════════════════════════════════════════
function Expenses({ expenses, accounts, onAdd, onDelete, onEdit, stats }) {
  const matchingAccounts = (cur) => accounts.filter(a => (a.currency || 'BDT') === cur);
  const defaultAcc = (cur) => matchingAccounts(cur)[0]?.name || 'Cash';
  const [form, setForm] = useState({ description: '', amount: '', currency: 'RM', category: 'Shipping', account: defaultAcc('RM'), date: new Date().toISOString().slice(0, 10) });
  const [filter, setFilter] = useState('all');
  const categories = ['Shipping', 'Packaging', 'Marketing', 'Payment Fees', 'Office', 'Travel', 'Cost of Goods', 'Other'];
  const submit = (e) => {
    e.preventDefault();
    if (!form.description || !form.amount) return;
    onAdd({ ...form, amount: parseFloat(form.amount), date: new Date(form.date).toISOString() });
    setForm({ description: '', amount: '', currency: form.currency, category: 'Shipping', account: defaultAcc(form.currency), date: new Date().toISOString().slice(0, 10) });
  };
  const filtered = filter === 'all' ? expenses : expenses.filter(e => e.currency === filter);
  // When currency changes, auto-pick a matching-currency account
  const onCurrencyChange = (cur) => setForm({ ...form, currency: cur, account: defaultAcc(cur) });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 18 }}>
      <div>
        <div className="pcg-card" style={{ position: 'sticky', top: 20 }}>
          <h3 style={{ fontFamily: T.serif, fontSize: 18, margin: '0 0 6px', fontWeight: 500 }}>Record Expense</h3>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 18 }}>Auto-deducts from the chosen account in your books.</div>
          <form onSubmit={submit}>
            <Field label="Description"><input className="pcg-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. Courier to Bangladesh" /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 10, marginTop: 12 }}>
              <Field label="Amount"><input className="pcg-input" type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></Field>
              <Field label="Currency"><select className="pcg-input" value={form.currency} onChange={e => onCurrencyChange(e.target.value)}><option>RM</option><option>BDT</option></select></Field>
            </div>
            <Field label={`Paid from (${form.currency} account)`} style={{ marginTop: 12 }}>
              <select className="pcg-input" value={form.account} onChange={e => setForm({ ...form, account: e.target.value })}>
                {matchingAccounts(form.currency).length === 0 && <option value="">No {form.currency} account — add one in Books</option>}
                {matchingAccounts(form.currency).map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Category" style={{ marginTop: 12 }}><select className="pcg-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{categories.map(c => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Date" style={{ marginTop: 12 }}><input className="pcg-input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
            <button type="submit" className="pcg-btn" style={{ marginTop: 18, width: '100%', justifyContent: 'center' }}><Plus size={14} /> Add Expense</button>
          </form>
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${T.borderSoft}` }}>
            <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 10 }}>Totals (this company)</div>
            <SummaryRow label="Malaysia" value={fmtRM(stats.expensesRM)} />
            <SummaryRow label="Bangladesh" value={fmtBDT(stats.expensesBDT)} />
          </div>
        </div>
      </div>
      <div className="pcg-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.borderSoft}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: T.serif, fontSize: 17, margin: 0, fontWeight: 500 }}>Expense Log</h3>
          <div style={{ display: 'flex', gap: 4 }}>
            {['all', 'RM', 'BDT'].map(f => <button key={f} onClick={() => setFilter(f)} style={{ padding: '5px 11px', fontSize: 12, fontWeight: 500, background: filter === f ? T.ink : 'transparent', color: filter === f ? T.cream : T.muted, border: `1px solid ${filter === f ? T.ink : T.border}`, borderRadius: 6, cursor: 'pointer' }}>{f === 'all' ? 'All' : f}</button>)}
          </div>
        </div>
        {filtered.length === 0 ? <div style={{ padding: 36 }}><EmptyState text="No expenses logged yet." /></div> : (
          <div>
            {filtered.map(e => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: `1px solid ${T.borderSoft}` }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: e.currency === 'RM' ? T.olive + '15' : T.terracotta + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', color: e.currency === 'RM' ? T.olive : T.terracotta, fontSize: 10.5, fontWeight: 700 }}>{e.currency}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{e.description}</div>
                  <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{e.category} · {e.account || 'no account'} · {fmtDate(e.date)}</div>
                </div>
                <div style={{ fontFamily: T.serif, fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{e.currency === 'RM' ? fmtRM(e.amount) : fmtBDT(e.amount)}</div>
                <button onClick={() => onEdit(e)} className="pcg-btn pcg-btn-ghost"><Pencil size={13} /></button>
                <button onClick={() => onDelete(e.id)} className="pcg-btn pcg-btn-ghost"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13.5, borderTop: highlight ? `1px solid ${T.borderSoft}` : 'none', marginTop: highlight ? 6 : 0, paddingTop: highlight ? 10 : 6 }}>
      <span style={{ color: highlight ? T.ink : T.inkSoft, fontWeight: highlight ? 500 : 400 }}>{label}</span>
      <span style={{ fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: highlight ? T.terracotta : T.ink }}>{value}</span>
    </div>
  );
}

function ExpenseEditModal({ expense, accounts, onClose, onSave }) {
  const [f, setF] = useState({ ...expense, date: fmtDateInput(expense.date) });
  const matchingAccounts = accounts.filter(a => (a.currency || 'BDT') === f.currency);
  return (
    <EditModal title="Edit Expense" onClose={onClose} onSave={() => onSave({ ...f, amount: parseFloat(f.amount), date: new Date(f.date).toISOString() })}>
      <Field label="Description"><input className="pcg-input" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 10, marginTop: 12 }}>
        <Field label="Amount"><input className="pcg-input" type="number" step="0.01" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Currency"><select className="pcg-input" value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })}><option>RM</option><option>BDT</option></select></Field>
      </div>
      <Field label={`Paid from (${f.currency} account)`} style={{ marginTop: 12 }}>
        <select className="pcg-input" value={f.account || ''} onChange={e => setF({ ...f, account: e.target.value })}>
          <option value="">— select account —</option>
          {matchingAccounts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Category" style={{ marginTop: 12 }}><input className="pcg-input" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} /></Field>
      <Field label="Date" style={{ marginTop: 12 }}><input className="pcg-input" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
    </EditModal>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BOOKS & LEDGER
// ═══════════════════════════════════════════════════════════════════
function Books({ accounts, ledger, loans, orders, expenses, settings, setSettings, onAddAccount, onEditAccount, onDeleteAccount, onAddLedger, onEditLedger, onDeleteLedger, onAddLoan, onEditLoan, onDeleteLoan, onRepay, onOwnerDraw, onOpenOrder, onTransfer }) {
  const [tab, setTab] = useState('overview');

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, background: T.surface, padding: 5, borderRadius: 10, border: `1px solid ${T.borderSoft}`, width: 'fit-content', flexWrap: 'wrap' }}>
        {[
          { id: 'overview', label: 'Overview', icon: LayoutDashboard },
          { id: 'profit', label: 'Profit', icon: TrendingUp },
          { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight },
          { id: 'transfer', label: 'Transfer', icon: ArrowLeftRight },
          { id: 'loans', label: 'Loans', icon: Banknote },
          { id: 'accounts', label: 'Accounts', icon: Landmark }
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            background: tab === t.id ? T.ink : 'transparent', color: tab === t.id ? T.cream : T.muted,
            border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer'
          }}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <BooksOverview accounts={accounts} ledger={ledger} loans={loans} orders={orders} onOpenOrder={onOpenOrder} />}
      {tab === 'profit' && <ProfitView orders={orders} expenses={expenses} ledger={ledger} settings={settings} setSettings={setSettings} onOwnerDraw={onOwnerDraw} />}
      {tab === 'transactions' && <Transactions ledger={ledger} accounts={accounts} onAdd={onAddLedger} onEdit={onEditLedger} onDelete={onDeleteLedger} />}
      {tab === 'transfer' && <TransferView accounts={accounts} ledger={ledger} onTransfer={onTransfer} />}
      {tab === 'loans' && <Loans loans={loans} onAdd={onAddLoan} onEdit={onEditLoan} onDelete={onDeleteLoan} onRepay={onRepay} />}
      {tab === 'accounts' && <Accounts accounts={accounts} ledger={ledger} onAdd={onAddAccount} onEdit={onEditAccount} onDelete={onDeleteAccount} />}
    </div>
  );
}

function BooksOverview({ accounts, ledger, loans, orders, onOpenOrder }) {
  const accountBalances = accounts.map(a => {
    // Only count ledger movements that match this account's currency
    const accCurrency = a.currency || 'BDT';
    const movements = ledger
      .filter(l => l.account === a.name && (l.currency || 'BDT') === accCurrency)
      .reduce((sum, l) => sum + (l.direction === 'in' ? parseFloat(l.amount) : -parseFloat(l.amount)), 0);
    return { ...a, balance: (parseFloat(a.openingBalance) || 0) + movements };
  });
  // Split BDT vs RM — never add them as a single number
  const bdtAccounts = accountBalances.filter(a => (a.currency || 'BDT') === 'BDT');
  const rmAccounts = accountBalances.filter(a => a.currency === 'RM');
  const totalBDT = bdtAccounts.reduce((s, a) => s + a.balance, 0);
  const totalRM = rmAccounts.reduce((s, a) => s + a.balance, 0);

  const monthly = useMemo(() => {
    const byMonth = {};
    ledger.forEach(l => {
      const m = monthKey(l.date);
      if (!byMonth[m]) byMonth[m] = { in: 0, out: 0 };
      const amt = parseFloat(l.amount) || 0;
      if (l.direction === 'in') byMonth[m].in += amt;
      else byMonth[m].out += amt;
    });
    return Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  }, [ledger]);

  const payables = loans.filter(l => l.type === 'taken' && l.status === 'open');
  const receivables = loans.filter(l => l.type === 'given' && l.status === 'open');

  // Customer pending dues — orders where advance is paid but not delivered
  const customerDues = (orders || [])
    .filter(o => o.advancePaid && !o.delivered)
    .map(o => {
      const c = calcOrder(o);
      return { ...o, dueAmount: c.due };
    });
  const totalCustomerDues = customerDues.reduce((s, o) => s + o.dueAmount, 0);

  return (
    <div>
      <div className="pcg-card" style={{ background: T.ink, color: T.cream, border: 'none', marginBottom: 14, display: 'flex', alignItems: 'stretch', gap: 0, padding: 0, overflow: 'hidden' }}>
        <div style={{ flex: 1, padding: '20px 24px' }}>
          <div style={{ fontSize: 11, color: T.cream + '99', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>Total Bank Balance · BDT</div>
          <div style={{ fontFamily: T.serif, fontSize: 40, fontWeight: 500, letterSpacing: '-0.02em', margin: '8px 0 4px', fontVariantNumeric: 'tabular-nums' }}>{fmtBDT(totalBDT)}</div>
          <div style={{ fontSize: 12, color: T.cream + 'AA' }}>Across {bdtAccounts.length} BDT account{bdtAccounts.length !== 1 ? 's' : ''}</div>
        </div>
        {rmAccounts.length > 0 && (
          <div style={{ width: 1, background: T.cream + '20' }} />
        )}
        {rmAccounts.length > 0 && (
          <div style={{ padding: '20px 24px', minWidth: 220, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontSize: 11, color: T.cream + '99', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>RM Balance · Malaysia</div>
            <div style={{ fontFamily: T.serif, fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em', margin: '6px 0 4px', fontVariantNumeric: 'tabular-nums' }}>{fmtRM(totalRM)}</div>
            <div style={{ fontSize: 11.5, color: T.cream + 'AA' }}>{rmAccounts.length} RM account{rmAccounts.length !== 1 ? 's' : ''} · kept separate</div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div className="pcg-card">
          <h3 style={{ fontFamily: T.serif, fontSize: 17, margin: '0 0 14px', fontWeight: 500 }}>Account Balances</h3>
          {accountBalances.length === 0 ? <EmptyState text="No accounts yet." /> : accountBalances.map((a, i) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < accountBalances.length - 1 ? `1px solid ${T.borderSoft}` : 'none' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: T.cream, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {a.type === 'Bank' ? <Landmark size={14} color={T.terracotta} /> : a.type === 'bKash' ? <Phone size={14} color={T.terracotta} /> : <Wallet size={14} color={T.terracotta} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{a.name}</div>
                <div style={{ fontSize: 11.5, color: T.muted }}>{a.type}</div>
              </div>
              <div style={{ fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 15, color: a.balance < 0 ? T.terracotta : T.ink }}>{fmtMoney(a.balance, a.currency)}</div>
            </div>
          ))}
        </div>

        <div className="pcg-card">
          <h3 style={{ fontFamily: T.serif, fontSize: 17, margin: '0 0 14px', fontWeight: 500 }}>Monthly Cashflow</h3>
          {monthly.length === 0 ? <EmptyState text="No transactions yet." /> : (
            <div>
              {monthly.map(([m, v]) => (
                <div key={m} style={{ padding: '10px 0', borderBottom: `1px solid ${T.borderSoft}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{monthLabel(m)}</span>
                    <span style={{ fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: (v.in - v.out) >= 0 ? T.success : T.terracotta }}>{fmtBDT(v.in - v.out)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: T.muted }}>
                    <span><ArrowUpRight size={11} style={{ display: 'inline', color: T.success }} /> In: {fmtBDT(v.in)}</span>
                    <span><ArrowDownRight size={11} style={{ display: 'inline', color: T.terracotta }} /> Out: {fmtBDT(v.out)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Customer pending dues — orders awaiting final payment */}
      {customerDues.length > 0 && (
        <div className="pcg-card" style={{ marginBottom: 14, borderLeft: `3px solid ${T.olive}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <ArrowUpRight size={18} color={T.olive} />
            <h3 style={{ fontFamily: T.serif, fontSize: 17, margin: 0, fontWeight: 500 }}>Customer Pending Dues</h3>
            <div style={{ marginLeft: 'auto', fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: T.olive, fontSize: 17 }}>{fmtBDT(totalCustomerDues)}</div>
          </div>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 10 }}>Orders where advance was paid but final payment is still pending.</div>
          {customerDues.map((o, i) => (
            <div key={o.id} onClick={() => onOpenOrder && onOpenOrder(o)} className="pcg-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, borderBottom: i < customerDues.length - 1 ? `1px solid ${T.borderSoft}` : 'none' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{o.customerName} <span style={{ color: T.muted, fontWeight: 400 }}>· {o.orderNumber}</span></div>
                <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{o.productName} · {STATUS[o.status]?.label}</div>
              </div>
              <div style={{ fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 15, color: T.olive }}>{fmtBDT(o.dueAmount)}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <PayableReceivableCard title="Payables (You Owe)" icon={ArrowDownRight} color={T.warning} items={payables} emptyText="No open payables." />
        <PayableReceivableCard title="Loan Receivables (Owed to You)" icon={ArrowUpRight} color={T.olive} items={receivables} emptyText="No open loan receivables." />
      </div>
    </div>
  );
}

function ProfitView({ orders, expenses, ledger, settings, setSettings, onOwnerDraw }) {
  const [periodFilter, setPeriodFilter] = useState('thisMonth');
  const todayStr = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date(); firstOfMonth.setDate(1);
  const [customFrom, setCustomFrom] = useState(firstOfMonth.toISOString().slice(0,10));
  const [customTo, setCustomTo] = useState(todayStr);
  const [showCustom, setShowCustom] = useState(false);

  const filterByPeriod = (iso) => {
    const d = new Date(iso);
    const now = new Date();
    if (periodFilter === 'thisMonth') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (periodFilter === 'thisYear') return d.getFullYear() === now.getFullYear();
    if (periodFilter === 'custom') {
      const from = new Date(customFrom + 'T00:00:00');
      const to = new Date(customTo + 'T23:59:59');
      return d >= from && d <= to;
    }
    return true; // 'all'
  };

  const rate = parseFloat(settings.realExchangeRate) || 25;

  // REVENUE — sum of selling price for delivered orders (in period)
  const revenue = orders
    .filter(o => o.delivered && filterByPeriod(o.orderDate))
    .reduce((s, o) => s + calcOrder(o).selling, 0);
  const deliveredCount = orders.filter(o => o.delivered && filterByPeriod(o.orderDate)).length;

  // COGS — from auto-created ledger entries (now stored in RM, convert to BDT for display)
  const deliveredInPeriod = orders.filter(o => o.delivered && filterByPeriod(o.orderDate));
  const deliveredIdSet = new Set(deliveredInPeriod.map(o => o.id));
  const cogs = ledger
    .filter(l => l.kind === 'cogs' && deliveredIdSet.has(l.relatedOrderId))
    .reduce((s, l) => {
      const amt = parseFloat(l.amount || 0);
      // New entries are RM; legacy entries are BDT — handle both
      return s + ((l.currency === 'RM' || !l.currency) ? amt * rate : amt);
    }, 0);

  // COSTS — operating expenses (BDT directly + RM converted). COGS handled separately above.
  const periodExpenses = expenses.filter(e => filterByPeriod(e.date));
  const expensesBDT = periodExpenses.filter(e => e.currency === 'BDT').reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const expensesRM = periodExpenses.filter(e => e.currency === 'RM').reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const expensesRMinBDT = expensesRM * rate;
  const operatingCosts = expensesBDT + expensesRMinBDT;
  const totalCosts = cogs + operatingCosts;

  // GROSS PROFIT
  const grossProfit = revenue - totalCosts;

  // OWNER'S DRAWS — ledger entries with kind=owner_draw (period filtered)
  const ownerDraws = ledger
    .filter(l => l.kind === 'owner_draw' && filterByPeriod(l.date))
    .reduce((s, l) => s + parseFloat(l.amount || 0), 0);

  // RETAINED IN BUSINESS
  const retained = grossProfit - ownerDraws;

  const fmtShort = (d) => new Date(d + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
  const periodLabel = periodFilter === 'thisMonth' ? 'This month'
    : periodFilter === 'thisYear' ? 'This year'
    : periodFilter === 'custom' ? `${fmtShort(customFrom)} – ${fmtShort(customTo)}`
    : 'All time';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 14, flexWrap: 'wrap' }}>
        <h3 style={{ fontFamily: T.serif, fontSize: 19, margin: 0, fontWeight: 500, alignSelf: 'center' }}>Live Profit · {periodLabel}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          {/* Period buttons */}
          <div style={{ display: 'flex', gap: 5 }}>
            {[
              { id: 'thisMonth', label: 'This Month' },
              { id: 'thisYear', label: 'This Year' },
              { id: 'all', label: 'All Time' },
              { id: 'custom', label: '📅 Custom Range' }
            ].map(p => (
              <button key={p.id} onClick={() => { setPeriodFilter(p.id); if (p.id === 'custom') setShowCustom(true); else setShowCustom(false); }} style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 500,
                background: periodFilter === p.id ? T.ink : T.surface,
                color: periodFilter === p.id ? T.cream : T.muted,
                border: `1px solid ${periodFilter === p.id ? T.ink : T.border}`,
                borderRadius: 7, cursor: 'pointer', transition: 'all 0.15s'
              }}>{p.label}</button>
            ))}
          </div>
          {/* Custom date range inputs */}
          {(periodFilter === 'custom' || showCustom) && (
            <div className="fade-in" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: T.cream, borderRadius: 10, border: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 11.5, color: T.muted, fontWeight: 500 }}>From</span>
              <input
                type="date" className="pcg-input"
                value={customFrom}
                onChange={e => { setCustomFrom(e.target.value); setPeriodFilter('custom'); }}
                style={{ width: 145, padding: '6px 10px', fontSize: 13 }}
              />
              <span style={{ fontSize: 11.5, color: T.muted, fontWeight: 500 }}>To</span>
              <input
                type="date" className="pcg-input"
                value={customTo}
                min={customFrom}
                onChange={e => { setCustomTo(e.target.value); setPeriodFilter('custom'); }}
                style={{ width: 145, padding: '6px 10px', fontSize: 13 }}
              />
              {customFrom && customTo && (
                <span style={{ fontSize: 11.5, color: T.terracotta, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {Math.round((new Date(customTo) - new Date(customFrom)) / 86400000) + 1} days
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Big headline card */}
      <div className="pcg-card" style={{ background: retained >= 0 ? T.ink : T.terracottaDark, color: T.cream, border: 'none', marginBottom: 14, display: 'flex', alignItems: 'stretch', padding: 0, overflow: 'hidden' }}>
        <div style={{ flex: 1, padding: '22px 26px' }}>
          <div style={{ fontSize: 11, color: T.cream + '99', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>Retained in Business</div>
          <div style={{ fontFamily: T.serif, fontSize: 42, fontWeight: 500, letterSpacing: '-0.02em', margin: '8px 0 4px', fontVariantNumeric: 'tabular-nums' }}>{fmtBDT(retained)}</div>
          <div style={{ fontSize: 12.5, color: T.cream + 'AA' }}>Profit not yet withdrawn — available for reinvestment</div>
        </div>
        <div style={{ width: 1, background: T.cream + '20' }} />
        <div style={{ padding: '22px 26px', minWidth: 200, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 11, color: T.cream + '99', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>Gross Profit</div>
          <div style={{ fontFamily: T.serif, fontSize: 26, fontWeight: 500, margin: '6px 0 4px', fontVariantNumeric: 'tabular-nums' }}>{fmtBDT(grossProfit)}</div>
          <div style={{ fontSize: 11.5, color: T.cream + 'AA' }}>before owner's draws</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
        {/* Profit breakdown */}
        <div className="pcg-card">
          <h4 style={{ fontFamily: T.serif, fontSize: 17, margin: '0 0 14px', fontWeight: 500 }}>Breakdown</h4>

          <ProfitLine label="Revenue" sub={`${deliveredCount} delivered order${deliveredCount !== 1 ? 's' : ''}`} value={fmtBDT(revenue)} positive />

          <div style={{ height: 1, background: T.borderSoft, margin: '14px 0' }} />

          <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>Cost of Goods Sold</div>
          <ProfitLine label="COGS" sub="RM cost × conversion rate, on delivered orders" value={`− ${fmtBDT(cogs)}`} />

          <div style={{ height: 1, background: T.borderSoft, margin: '14px 0' }} />

          <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 8 }}>Operating Costs</div>
          <ProfitLine label="Expenses (BDT)" sub="recorded in Bangladesh" value={`− ${fmtBDT(expensesBDT)}`} />
          <ProfitLine label="Expenses (RM)" sub={`recorded in Malaysia · ${fmtRM(expensesRM)} converted @ ${rate}`} value={`− ${fmtBDT(expensesRMinBDT)}`} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, padding: '10px 0', borderTop: `1px solid ${T.borderSoft}` }}>
            <span style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>Total Costs (BDT)</span>
            <span style={{ fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 16 }}>− {fmtBDT(totalCosts)}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, padding: '10px 0', borderTop: `2px solid ${T.ink}` }}>
            <span style={{ fontSize: 14, color: T.ink, fontWeight: 600 }}>Gross Profit</span>
            <span style={{ fontFamily: T.serif, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: 19, color: grossProfit >= 0 ? T.success : T.terracotta }}>{fmtBDT(grossProfit)}</span>
          </div>

          <div style={{ height: 1, background: T.borderSoft, margin: '14px 0' }} />

          <ProfitLine label="Owner's Draws" sub="profit you've withdrawn for personal use" value={`− ${fmtBDT(ownerDraws)}`} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, padding: '10px 0', borderTop: `2px solid ${T.ink}` }}>
            <span style={{ fontSize: 14, color: T.ink, fontWeight: 600 }}>Retained in Business</span>
            <span style={{ fontFamily: T.serif, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: 19, color: retained >= 0 ? T.success : T.terracotta }}>{fmtBDT(retained)}</span>
          </div>
        </div>

        {/* Settings + actions */}
        <div>
          <div className="pcg-card" style={{ marginBottom: 14 }}>
            <h4 style={{ fontFamily: T.serif, fontSize: 16, margin: '0 0 10px', fontWeight: 500 }}>Conversion Rate</h4>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 10 }}>For converting RM expenses to BDT in profit calculations. (This is different from the 50× selling-price formula.)</div>
            <Field label="Real RM → BDT Rate">
              <input className="pcg-input" type="number" step="0.01" value={settings.realExchangeRate} onChange={e => setSettings({ ...settings, realExchangeRate: parseFloat(e.target.value) || 0 })} style={{ fontFamily: T.serif, fontSize: 18 }} />
            </Field>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 8 }}>Tip: use the real market rate, not your selling multiplier.</div>
          </div>

          <div className="pcg-card">
            <h4 style={{ fontFamily: T.serif, fontSize: 16, margin: '0 0 8px', fontWeight: 500 }}>Take Profit Out</h4>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 12 }}>Withdraw profit as an owner's draw. This deducts from your retained profit and the chosen account.</div>
            <button onClick={onOwnerDraw} className="pcg-btn" style={{ width: '100%', justifyContent: 'center' }}><Wallet size={14} /> Record Owner's Draw</button>
          </div>
        </div>
      </div>

      <div style={{ padding: 14, background: T.cream, borderRadius: 10, fontSize: 12.5, color: T.muted, lineHeight: 1.6 }}>
        <strong style={{ color: T.ink }}>How this works:</strong> Every delivered order's selling price is counted as revenue. Every expense — whether recorded in BDT or RM — is subtracted. RM amounts use your conversion rate above. Profit you don't withdraw stays as retained earnings inside the business cash position, ready to fund future inventory or operations.
      </div>
    </div>
  );
}

function ProfitLine({ label, sub, value, positive }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0' }}>
      <div>
        <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 16, color: positive ? T.success : T.inkSoft }}>{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ORDER PAYMENT MODAL — supports splitting one payment across methods
// ═══════════════════════════════════════════════════════════════════
function OrderPaymentModal({ prompt, accounts, onCancel, onConfirm }) {
  const { order, kind, defaultAmount } = prompt;
  const bdtAccounts = accounts.filter(a => (a.currency || 'BDT') === 'BDT');
  const firstAccount = bdtAccounts[0]?.name || 'Cash';

  const isAdvance = kind === 'order_advance';
  const c = calcOrder(order);
  const expectedAmount = isAdvance ? c.advance : c.due;
  const bkashAmount = isAdvance ? c.advanceBkash : c.dueBkash;

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [splits, setSplits] = useState([
    { id: uid(), amount: defaultAmount, account: firstAccount, method: isAdvance ? 'bKash' : 'Cash on Delivery', notes: '' }
  ]);

  const addSplit = () => setSplits([...splits, { id: uid(), amount: '', account: firstAccount, method: 'bKash', notes: '' }]);
  const updateSplit = (id, key, value) => setSplits(splits.map(s => s.id === id ? { ...s, [key]: value } : s));
  const removeSplit = (id) => { if (splits.length > 1) setSplits(splits.filter(s => s.id !== id)); };

  const totalEntered = splits.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);
  const isSplit = splits.length > 1;
  const remaining = expectedAmount - totalEntered;

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 250, backdropFilter: 'blur(6px)', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} className="fade-in" style={{ background: T.cream, borderRadius: 14, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${T.border}`, background: T.surface, position: 'sticky', top: 0, zIndex: 5 }}>
          <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{order.orderNumber} · {order.customerName}</div>
          <h3 style={{ fontFamily: T.serif, fontSize: 21, margin: '6px 0 0', fontWeight: 500 }}>
            {isAdvance ? 'Record Advance Payment' : 'Record Final Payment'}
          </h3>
        </div>

        <div style={{ padding: 22 }}>
          <div style={{ padding: 12, background: T.surface, borderRadius: 8, marginBottom: 16, fontSize: 12.5, color: T.muted, lineHeight: 1.6 }}>
            Expected: <strong style={{ color: T.ink, fontFamily: T.serif }}>{fmtBDT(expectedAmount)}</strong> direct, or <strong style={{ color: T.ink, fontFamily: T.serif }}>{fmtBDT(bkashAmount)}</strong> via bKash (incl. 2% fee). Split across methods below if the customer pays partly by bank and partly by bKash.
          </div>

          <Field label="Date Received">
            <input className="pcg-input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ maxWidth: 220 }} />
          </Field>

          <div style={{ marginTop: 16, fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            Payment {isSplit ? 'Splits' : 'Details'}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {splits.map((s, idx) => (
              <div key={s.id} style={{ padding: 12, background: T.surface, border: `1px solid ${T.borderSoft}`, borderRadius: 10 }}>
                {isSplit && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Payment {idx + 1}</div>
                    <button type="button" onClick={() => removeSplit(s.id)} className="pcg-btn pcg-btn-ghost pcg-btn-sm" style={{ color: T.terracotta }}>
                      <Trash2 size={12} /> Remove
                    </button>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Amount (BDT)">
                    <input className="pcg-input" type="number" step="0.01" value={s.amount} onChange={e => updateSplit(s.id, 'amount', e.target.value)} style={{ fontFamily: T.serif, fontSize: 16 }} />
                  </Field>
                  <Field label="Payment Method">
                    <select className="pcg-input" value={s.method} onChange={e => updateSplit(s.id, 'method', e.target.value)}>
                      <option>bKash</option>
                      <option>Bank Transfer</option>
                      <option>Cash on Delivery</option>
                      <option>Cash</option>
                      <option>Other</option>
                    </select>
                  </Field>
                </div>
                <Field label="Deposit into Account" style={{ marginTop: 10 }}>
                  <select className="pcg-input" value={s.account} onChange={e => updateSplit(s.id, 'account', e.target.value)}>
                    {bdtAccounts.length === 0 && <option value="Cash">Cash (no BDT accounts — add one in Books)</option>}
                    {bdtAccounts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                  </select>
                </Field>
                <Field label="Notes (optional)" style={{ marginTop: 10 }}>
                  <input className="pcg-input" value={s.notes} onChange={e => updateSplit(s.id, 'notes', e.target.value)} placeholder="e.g. bKash TXN ABC1234" />
                </Field>
              </div>
            ))}
          </div>

          <button type="button" onClick={addSplit} className="pcg-btn pcg-btn-secondary" style={{ marginTop: 10 }}>
            <Plus size={13} /> Add Another Payment Method
          </button>

          {/* Running total */}
          <div style={{ marginTop: 16, padding: 12, background: T.ink, color: T.cream, borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10.5, color: T.cream + '99', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Total Entered</div>
              {Math.abs(remaining) > 0.5 && (
                <div style={{ fontSize: 11, color: remaining > 0 ? '#F0C674' : '#F0A0A0', marginTop: 2 }}>
                  {remaining > 0 ? `${fmtBDT(remaining)} less than expected` : `${fmtBDT(-remaining)} more than expected`}
                </div>
              )}
            </div>
            <div style={{ fontFamily: T.serif, fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtBDT(totalEntered)}</div>
          </div>

          <div style={{ marginTop: 12, padding: 10, background: T.success + '12', borderRadius: 8, fontSize: 12, color: T.success, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Check size={14} /> {isSplit ? `${splits.length} ledger entries will be created — one per payment method.` : 'A matching ledger entry will be created automatically.'}
          </div>
        </div>

        <div style={{ padding: '14px 22px', borderTop: `1px solid ${T.border}`, background: T.surface, display: 'flex', gap: 10, justifyContent: 'flex-end', position: 'sticky', bottom: 0 }}>
          <button onClick={onCancel} className="pcg-btn pcg-btn-secondary">Cancel</button>
          <button onClick={() => onConfirm({ date, splits })} className="pcg-btn" disabled={totalEntered <= 0}><Check size={14} /> Confirm Payment</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// OWNER DRAW MODAL — withdrawing profit from the business
// ═══════════════════════════════════════════════════════════════════
function OwnerDrawModal({ accounts, onCancel, onConfirm }) {
  const bdtAccounts = accounts.filter(a => (a.currency || 'BDT') === 'BDT');
  const [form, setForm] = useState({
    amount: '',
    account: bdtAccounts[0]?.name || 'Cash',
    date: new Date().toISOString().slice(0, 10),
    description: 'Owner\'s draw'
  });

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 250, backdropFilter: 'blur(6px)' }}>
      <div onClick={e => e.stopPropagation()} className="fade-in" style={{ background: T.cream, borderRadius: 14, width: '90%', maxWidth: 480, overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
          <h3 style={{ fontFamily: T.serif, fontSize: 21, margin: 0, fontWeight: 500 }}>Record Owner's Draw</h3>
          <div style={{ fontSize: 12.5, color: T.muted, marginTop: 4 }}>Money you're taking out of the business as profit.</div>
        </div>
        <div style={{ padding: 22 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Amount (BDT)"><input className="pcg-input" type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} style={{ fontFamily: T.serif, fontSize: 18 }} /></Field>
            <Field label="Date"><input className="pcg-input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
          </div>
          <Field label="From Account" style={{ marginTop: 12 }}>
            <select className="pcg-input" value={form.account} onChange={e => setForm({ ...form, account: e.target.value })}>
              {bdtAccounts.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Notes" style={{ marginTop: 12 }}>
            <input className="pcg-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. Monthly salary withdrawal" />
          </Field>
        </div>
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${T.border}`, background: T.surface, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className="pcg-btn pcg-btn-secondary">Cancel</button>
          <button onClick={() => onConfirm({
            date: new Date(form.date).toISOString(),
            direction: 'out',
            type: 'Owner\'s Draw',
            account: form.account,
            party: 'Owner',
            amount: parseFloat(form.amount),
            currency: 'BDT',
            description: form.description
          })} className="pcg-btn" disabled={!form.amount}>Record Draw</button>
        </div>
      </div>
    </div>
  );
}

function PayableReceivableCard({ title, icon: Icon, color, items, emptyText }) {
  const total = items.reduce((s, l) => s + (l.principal - (l.amountRepaid || 0)), 0);
  return (
    <div className="pcg-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Icon size={18} color={color} />
        <h3 style={{ fontFamily: T.serif, fontSize: 17, margin: 0, fontWeight: 500 }}>{title}</h3>
        <div style={{ marginLeft: 'auto', fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color, fontSize: 17 }}>{fmtBDT(total)}</div>
      </div>
      {items.length === 0 ? <EmptyState text={emptyText} /> : items.map((l, i) => (
        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < items.length - 1 ? `1px solid ${T.borderSoft}` : 'none' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{l.party}</div>
            <div style={{ fontSize: 11.5, color: T.muted }}>{fmtDate(l.date)} {l.dueDate ? `· due ${fmtDate(l.dueDate)}` : ''}</div>
          </div>
          <div style={{ fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>{fmtMoney(l.principal - (l.amountRepaid || 0), l.currency)}</div>
        </div>
      ))}
    </div>
  );
}

function TransferView({ accounts, ledger, onTransfer }) {
  const [form, setForm] = useState({
    fromAccount: accounts[0]?.name || '',
    toAccount: accounts[1]?.name || accounts[0]?.name || '',
    fromAmount: '',
    rate: '',
    toAmount: '',
    rateLocked: false, // when true, we use the typed rate; when false, derive from amounts if user edits toAmount
    date: new Date().toISOString().slice(0, 10),
    notes: '',
    fee: '',
    feeAccount: accounts[0]?.name || ''
  });

  const fromAcc = accounts.find(a => a.name === form.fromAccount);
  const toAcc = accounts.find(a => a.name === form.toAccount);
  const fromCurrency = fromAcc?.currency || 'BDT';
  const toCurrency = toAcc?.currency || 'BDT';
  const isCrossCurrency = fromCurrency !== toCurrency;

  // Compute toAmount automatically for cross-currency when rate is filled
  // For same-currency, toAmount always equals fromAmount
  useEffect(() => {
    if (!isCrossCurrency) {
      if (form.toAmount !== form.fromAmount) {
        setForm(f => ({ ...f, toAmount: f.fromAmount, rate: '' }));
      }
      return;
    }
    const fa = parseFloat(form.fromAmount) || 0;
    const r = parseFloat(form.rate) || 0;
    if (fa > 0 && r > 0) {
      // RM → BDT: BDT = RM * rate. BDT → RM: RM = BDT / rate.
      const derivedTo = fromCurrency === 'RM' ? fa * r : fa / r;
      if (Math.abs((parseFloat(form.toAmount) || 0) - derivedTo) > 0.005) {
        setForm(f => ({ ...f, toAmount: derivedTo.toFixed(2) }));
      }
    }
  }, [form.fromAmount, form.rate, isCrossCurrency, fromCurrency]);

  // Live balance preview
  const previewBalance = (accName, currency) => {
    if (!accName) return 0;
    const acc = accounts.find(a => a.name === accName);
    if (!acc) return 0;
    const opening = parseFloat(acc.openingBalance) || 0;
    const moves = ledger
      .filter(l => l.account === accName && (l.currency || 'BDT') === (acc.currency || 'BDT'))
      .reduce((s, l) => s + (l.direction === 'in' ? parseFloat(l.amount) : -parseFloat(l.amount)), 0);
    return opening + moves;
  };
  const fromBalance = previewBalance(form.fromAccount, fromCurrency);
  const toBalance = previewBalance(form.toAccount, toCurrency);
  const feeAmt = parseFloat(form.fee) || 0;
  const fromAmt = parseFloat(form.fromAmount) || 0;
  const fromAccDeducted = fromAmt + (form.feeAccount === form.fromAccount ? feeAmt : 0);
  const projectedFromAfter = fromBalance - fromAccDeducted;
  const projectedToAfter = toBalance + (parseFloat(form.toAmount) || 0);

  const submit = (e) => {
    e.preventDefault();
    if (!form.fromAccount || !form.toAccount) return alert('Pick both source and destination accounts.');
    if (form.fromAccount === form.toAccount) return alert('Source and destination must be different accounts.');
    if (!fromAmt) return alert('Enter the amount to transfer.');
    if (isCrossCurrency && !parseFloat(form.rate)) return alert('Cross-currency transfers need a conversion rate.');
    onTransfer({
      fromAccount: form.fromAccount,
      toAccount: form.toAccount,
      fromCurrency, toCurrency,
      fromAmount: fromAmt,
      toAmount: parseFloat(form.toAmount) || fromAmt,
      rate: parseFloat(form.rate) || 1,
      fee: feeAmt,
      feeAccount: feeAmt > 0 ? form.feeAccount : null,
      date: form.date,
      notes: form.notes
    });
    // Reset just the amounts
    setForm(f => ({ ...f, fromAmount: '', toAmount: '', fee: '', notes: '' }));
  };

  return (
    <form onSubmit={submit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18 }}>
        <div className="pcg-card">
          <h3 style={{ fontFamily: T.serif, fontSize: 19, margin: '0 0 6px', fontWeight: 500 }}>Transfer Between Accounts</h3>
          <div style={{ fontSize: 12.5, color: T.muted, marginBottom: 18 }}>Move money between any two accounts — same currency or BDT ⇄ RM with a rate. Creates one out-entry and one in-entry automatically.</div>

          <Section title="From and To">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 1fr', gap: 10, alignItems: 'end' }}>
              <Field label="From Account">
                <select className="pcg-input" value={form.fromAccount} onChange={e => setForm({ ...form, fromAccount: e.target.value })}>
                  {accounts.map(a => <option key={a.id} value={a.name}>{a.name} ({a.currency || 'BDT'})</option>)}
                </select>
              </Field>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 10 }}>
                <ArrowLeftRight size={18} color={T.terracotta} />
              </div>
              <Field label="To Account">
                <select className="pcg-input" value={form.toAccount} onChange={e => setForm({ ...form, toAccount: e.target.value })}>
                  {accounts.map(a => <option key={a.id} value={a.name}>{a.name} ({a.currency || 'BDT'})</option>)}
                </select>
              </Field>
            </div>
            {isCrossCurrency && (
              <div style={{ marginTop: 10, padding: 10, background: T.terracotta + '0E', border: `1px solid ${T.terracotta}25`, borderRadius: 8, fontSize: 12, color: T.inkSoft }}>
                <strong style={{ color: T.terracotta }}>Cross-currency transfer:</strong> {fromCurrency} → {toCurrency}. Enter your conversion rate below.
              </div>
            )}
          </Section>

          <Section title={isCrossCurrency ? 'Amounts & Rate' : 'Amount'}>
            {isCrossCurrency ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 1fr', gap: 10, alignItems: 'end' }}>
                <Field label={`From (${fromCurrency})`}>
                  <input className="pcg-input" type="number" step="0.01" min="0" value={form.fromAmount} onChange={e => setForm({ ...form, fromAmount: e.target.value })} style={{ fontFamily: T.serif, fontSize: 17 }} />
                </Field>
                <Field label="Rate">
                  <input className="pcg-input" type="number" step="0.01" min="0" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} placeholder={fromCurrency === 'RM' ? '32.50' : '0.031'} style={{ fontFamily: T.serif, fontSize: 16, textAlign: 'center' }} />
                </Field>
                <Field label={`To (${toCurrency})`}>
                  <input className="pcg-input" type="number" step="0.01" min="0" value={form.toAmount} onChange={e => setForm({ ...form, toAmount: e.target.value })} style={{ fontFamily: T.serif, fontSize: 17 }} />
                </Field>
              </div>
            ) : (
              <Field label={`Amount (${fromCurrency})`}>
                <input className="pcg-input" type="number" step="0.01" min="0" value={form.fromAmount} onChange={e => setForm({ ...form, fromAmount: e.target.value })} style={{ fontFamily: T.serif, fontSize: 18 }} />
              </Field>
            )}
            {isCrossCurrency && form.rate && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: T.muted, textAlign: 'center' }}>
                {fromCurrency === 'RM'
                  ? `RM 1 = BDT ${form.rate} · so RM ${fromAmt || 0} = BDT ${((fromAmt || 0) * (parseFloat(form.rate) || 0)).toFixed(2)}`
                  : `BDT ${form.rate} = RM 1 · so BDT ${fromAmt || 0} = RM ${((fromAmt || 0) / (parseFloat(form.rate) || 1)).toFixed(2)}`}
              </div>
            )}
          </Section>

          <Section title="Transfer Fee (optional)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Fee Amount">
                <input className="pcg-input" type="number" step="0.01" min="0" value={form.fee} onChange={e => setForm({ ...form, fee: e.target.value })} placeholder="0.00" />
              </Field>
              <Field label="Pay Fee From">
                <select className="pcg-input" value={form.feeAccount} onChange={e => setForm({ ...form, feeAccount: e.target.value })}>
                  {accounts.map(a => <option key={a.id} value={a.name}>{a.name} ({a.currency || 'BDT'})</option>)}
                </select>
              </Field>
            </div>
            {feeAmt > 0 && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: T.muted }}>
                Fee will be logged as an expense under "Payment Fees" and deducted from your <strong style={{ color: T.ink }}>{form.feeAccount}</strong> account.
              </div>
            )}
          </Section>

          <Section title="Details" last>
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10 }}>
              <Field label="Date"><input className="pcg-input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
              <Field label="Notes (optional)"><input className="pcg-input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Wise transfer ref ABC123" /></Field>
            </div>
          </Section>

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button type="submit" className="pcg-btn" disabled={!fromAmt || form.fromAccount === form.toAccount}>
              <ArrowLeftRight size={14} /> Record Transfer
            </button>
          </div>
        </div>

        {/* Live balance preview */}
        <div>
          <div className="pcg-card" style={{ position: 'sticky', top: 20 }}>
            <h4 style={{ fontFamily: T.serif, fontSize: 17, margin: '0 0 14px', fontWeight: 500 }}>Balance Preview</h4>

            <div style={{ padding: '12px 0', borderBottom: `1px solid ${T.borderSoft}` }}>
              <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>From · {form.fromAccount || '—'}</div>
              <div style={{ marginTop: 6 }}>
                <PreviewLine label="Current" value={fmtMoney(fromBalance, fromCurrency)} />
                <PreviewLine label="Transfer out" value={`− ${fmtMoney(fromAmt, fromCurrency)}`} muted />
                {feeAmt > 0 && form.feeAccount === form.fromAccount && (
                  <PreviewLine label="Fee" value={`− ${fmtMoney(feeAmt, fromCurrency)}`} muted />
                )}
                <PreviewLine label="After" value={fmtMoney(projectedFromAfter, fromCurrency)} bold color={projectedFromAfter < 0 ? T.terracotta : T.ink} />
              </div>
            </div>

            <div style={{ padding: '12px 0' }}>
              <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>To · {form.toAccount || '—'}</div>
              <div style={{ marginTop: 6 }}>
                <PreviewLine label="Current" value={fmtMoney(toBalance, toCurrency)} />
                <PreviewLine label="Transfer in" value={`+ ${fmtMoney(parseFloat(form.toAmount) || 0, toCurrency)}`} muted />
                <PreviewLine label="After" value={fmtMoney(projectedToAfter, toCurrency)} bold color={T.success} />
              </div>
            </div>

            {feeAmt > 0 && form.feeAccount !== form.fromAccount && (
              <div style={{ padding: '12px 0', borderTop: `1px solid ${T.borderSoft}` }}>
                <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>Fee from · {form.feeAccount}</div>
                <div style={{ marginTop: 6 }}>
                  <PreviewLine label="Fee" value={`− ${fmtMoney(feeAmt, accounts.find(a => a.name === form.feeAccount)?.currency || 'BDT')}`} bold color={T.terracotta} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

function PreviewLine({ label, value, bold, muted, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: muted ? 12 : 13 }}>
      <span style={{ color: muted ? T.muted : T.inkSoft }}>{label}</span>
      <span style={{ fontFamily: bold ? T.serif : T.sans, fontWeight: bold ? 500 : 400, fontSize: bold ? 15 : (muted ? 12 : 13), fontVariantNumeric: 'tabular-nums', color: color || (muted ? T.muted : T.ink) }}>{value}</span>
    </div>
  );
}

function Transactions({ ledger, accounts, onAdd, onEdit, onDelete }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), direction: 'in', type: 'Sale', amount: '', currency: 'BDT', account: accounts[0]?.name || 'Cash', party: '', description: '' });
  const submit = (e) => {
    e.preventDefault();
    onAdd({ ...form, amount: parseFloat(form.amount), date: new Date(form.date).toISOString() });
    setForm({ ...form, amount: '', party: '', description: '' });
    setShow(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontFamily: T.serif, fontSize: 19, margin: 0, fontWeight: 500 }}>All Transactions</h3>
        <button onClick={() => setShow(!show)} className="pcg-btn"><Plus size={14} /> Add Transaction</button>
      </div>

      {show && (
        <form onSubmit={submit} className="pcg-card fade-in" style={{ marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <Field label="Date"><input className="pcg-input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Direction"><select className="pcg-input" value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })}><option value="in">Money In</option><option value="out">Money Out</option></select></Field>
            <Field label="Type"><input className="pcg-input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} placeholder="e.g. Sale, Expense" /></Field>
            <Field label="Account"><select className="pcg-input" value={form.account} onChange={e => setForm({ ...form, account: e.target.value })}>{accounts.map(a => <option key={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Amount"><input className="pcg-input" type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required /></Field>
            <Field label="Currency"><select className="pcg-input" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}><option>BDT</option><option>RM</option></select></Field>
            <Field label="Party (optional)"><input className="pcg-input" value={form.party} onChange={e => setForm({ ...form, party: e.target.value })} /></Field>
            <Field label="Description"><input className="pcg-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button type="button" className="pcg-btn pcg-btn-secondary" onClick={() => setShow(false)}>Cancel</button>
            <button type="submit" className="pcg-btn">Save Transaction</button>
          </div>
        </form>
      )}

      <div className="pcg-card" style={{ padding: 0, overflow: 'hidden' }}>
        {ledger.length === 0 ? <div style={{ padding: 36 }}><EmptyState text="No transactions yet." /></div> : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '100px 80px 1fr 1fr 130px 90px', padding: '12px 18px', borderBottom: `1px solid ${T.borderSoft}`, fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>
              <div>Date</div><div>Type</div><div>Account / Party</div><div>Description</div><div style={{ textAlign: 'right' }}>Amount</div><div></div>
            </div>
            {ledger.map(l => (
              <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '100px 80px 1fr 1fr 130px 90px', padding: '12px 18px', borderBottom: `1px solid ${T.borderSoft}`, alignItems: 'center', fontSize: 13 }}>
                <div style={{ color: T.muted }}>{fmtDateShort(l.date)}</div>
                <div>
                  <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, background: l.direction === 'in' ? T.success + '20' : T.terracotta + '20', color: l.direction === 'in' ? T.success : T.terracotta, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase' }}>
                    {l.direction === 'in' ? 'In' : 'Out'}
                  </span>
                </div>
                <div><div style={{ color: T.ink, fontWeight: 500 }}>{l.account}</div>{l.party && <div style={{ fontSize: 11.5, color: T.muted }}>{l.party}</div>}</div>
                <div style={{ color: T.inkSoft }}><div style={{ fontSize: 12, color: T.muted, marginBottom: 2 }}>{l.type}</div>{l.description}</div>
                <div style={{ textAlign: 'right', fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 14, color: l.direction === 'in' ? T.success : T.terracotta }}>
                  {l.direction === 'in' ? '+' : '−'} {fmtMoney(l.amount, l.currency).replace(/^(BDT|RM)\s/, '')}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                  <button onClick={() => onEdit(l)} className="pcg-btn pcg-btn-ghost"><Pencil size={12} /></button>
                  <button onClick={() => onDelete(l.id)} className="pcg-btn pcg-btn-ghost"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LedgerEditModal({ entry, accounts, onClose, onSave }) {
  const [f, setF] = useState({ ...entry, date: fmtDateInput(entry.date) });
  return (
    <EditModal title="Edit Transaction" onClose={onClose} onSave={() => onSave({ ...f, amount: parseFloat(f.amount), date: new Date(f.date).toISOString() })}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Date"><input className="pcg-input" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Direction"><select className="pcg-input" value={f.direction} onChange={e => setF({ ...f, direction: e.target.value })}><option value="in">In</option><option value="out">Out</option></select></Field>
        <Field label="Type"><input className="pcg-input" value={f.type} onChange={e => setF({ ...f, type: e.target.value })} /></Field>
        <Field label="Account"><select className="pcg-input" value={f.account} onChange={e => setF({ ...f, account: e.target.value })}>{accounts.map(a => <option key={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Amount"><input className="pcg-input" type="number" step="0.01" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Currency"><select className="pcg-input" value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })}><option>BDT</option><option>RM</option></select></Field>
      </div>
      <Field label="Party" style={{ marginTop: 10 }}><input className="pcg-input" value={f.party || ''} onChange={e => setF({ ...f, party: e.target.value })} /></Field>
      <Field label="Description" style={{ marginTop: 10 }}><input className="pcg-input" value={f.description || ''} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
    </EditModal>
  );
}

function Loans({ loans, onAdd, onEdit, onDelete, onRepay }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ type: 'taken', party: '', principal: '', currency: 'BDT', date: new Date().toISOString().slice(0, 10), dueDate: '', account: 'Cash', notes: '' });
  const submit = (e) => {
    e.preventDefault();
    onAdd({ ...form, principal: parseFloat(form.principal), date: new Date(form.date).toISOString(), dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null });
    setForm({ ...form, party: '', principal: '', dueDate: '', notes: '' });
    setShow(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontFamily: T.serif, fontSize: 19, margin: 0, fontWeight: 500 }}>Loans & Borrowings</h3>
        <button onClick={() => setShow(!show)} className="pcg-btn"><Plus size={14} /> Record Loan</button>
      </div>

      {show && (
        <form onSubmit={submit} className="pcg-card fade-in" style={{ marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <Field label="Type"><select className="pcg-input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value="taken">Loan Taken (I owe)</option><option value="given">Loan Given (Owed to me)</option></select></Field>
            <Field label="Party Name *"><input className="pcg-input" value={form.party} onChange={e => setForm({ ...form, party: e.target.value })} required placeholder="Person or company" /></Field>
            <Field label="Principal *"><input className="pcg-input" type="number" step="0.01" value={form.principal} onChange={e => setForm({ ...form, principal: e.target.value })} required /></Field>
            <Field label="Currency"><select className="pcg-input" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}><option>BDT</option><option>RM</option></select></Field>
            <Field label="Date"><input className="pcg-input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Due Date (optional)"><input className="pcg-input" type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></Field>
            <Field label="Account"><input className="pcg-input" value={form.account} onChange={e => setForm({ ...form, account: e.target.value })} /></Field>
            <Field label="Notes"><input className="pcg-input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button type="button" className="pcg-btn pcg-btn-secondary" onClick={() => setShow(false)}>Cancel</button>
            <button type="submit" className="pcg-btn">Save Loan</button>
          </div>
        </form>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <LoanList title="Loans Taken (Payables)" loans={loans.filter(l => l.type === 'taken')} onEdit={onEdit} onDelete={onDelete} onRepay={onRepay} color={T.warning} />
        <LoanList title="Loans Given (Receivables)" loans={loans.filter(l => l.type === 'given')} onEdit={onEdit} onDelete={onDelete} onRepay={onRepay} color={T.olive} />
      </div>
    </div>
  );
}

function LoanList({ title, loans, onEdit, onDelete, onRepay, color }) {
  return (
    <div className="pcg-card">
      <h4 style={{ fontFamily: T.serif, fontSize: 16, margin: '0 0 12px', fontWeight: 500 }}>{title}</h4>
      {loans.length === 0 ? <EmptyState text="None yet." /> : loans.map(l => {
        const remaining = l.principal - (l.amountRepaid || 0);
        const pct = l.principal > 0 ? ((l.amountRepaid || 0) / l.principal) * 100 : 0;
        return (
          <div key={l.id} style={{ padding: '12px 0', borderBottom: `1px solid ${T.borderSoft}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 14, color: T.ink, fontWeight: 500 }}>{l.party}</div>
                <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>
                  {fmtDate(l.date)} {l.dueDate ? `· due ${fmtDate(l.dueDate)}` : ''}
                  {l.status === 'settled' && <span style={{ marginLeft: 8, padding: '1px 6px', background: T.success + '20', color: T.success, borderRadius: 3, fontSize: 10, fontWeight: 600 }}>SETTLED</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 16 }}>{fmtMoney(remaining, l.currency)}</div>
                <div style={{ fontSize: 10.5, color: T.muted }}>of {fmtMoney(l.principal, l.currency)}</div>
              </div>
            </div>
            <div style={{ height: 4, background: T.borderSoft, borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 0.3s' }} />
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 8, justifyContent: 'flex-end' }}>
              {l.status === 'open' && <button onClick={() => onEdit(l)} className="pcg-btn pcg-btn-secondary pcg-btn-sm">Record Repayment</button>}
              <button onClick={() => onEdit(l)} className="pcg-btn pcg-btn-ghost pcg-btn-sm"><Pencil size={12} /></button>
              <button onClick={() => onDelete(l.id)} className="pcg-btn pcg-btn-ghost pcg-btn-sm"><Trash2 size={12} /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoanEditModal({ loan, onClose, onSave, onRepay }) {
  const [f, setF] = useState({ ...loan, date: fmtDateInput(loan.date), dueDate: fmtDateInput(loan.dueDate) });
  const [repayAmt, setRepayAmt] = useState('');
  const [repayDate, setRepayDate] = useState(new Date().toISOString().slice(0, 10));
  const remaining = loan.principal - (loan.amountRepaid || 0);

  return (
    <EditModal title="Edit Loan" onClose={onClose} onSave={() => onSave({ ...f, principal: parseFloat(f.principal), date: new Date(f.date).toISOString(), dueDate: f.dueDate ? new Date(f.dueDate).toISOString() : null })}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Type"><select className="pcg-input" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option value="taken">Taken</option><option value="given">Given</option></select></Field>
        <Field label="Party"><input className="pcg-input" value={f.party} onChange={e => setF({ ...f, party: e.target.value })} /></Field>
        <Field label="Principal"><input className="pcg-input" type="number" value={f.principal} onChange={e => setF({ ...f, principal: e.target.value })} /></Field>
        <Field label="Currency"><select className="pcg-input" value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })}><option>BDT</option><option>RM</option></select></Field>
        <Field label="Date"><input className="pcg-input" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Due Date"><input className="pcg-input" type="date" value={f.dueDate || ''} onChange={e => setF({ ...f, dueDate: e.target.value })} /></Field>
      </div>
      <Field label="Status" style={{ marginTop: 10 }}><select className="pcg-input" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="open">Open</option><option value="settled">Settled</option></select></Field>
      <Field label="Notes" style={{ marginTop: 10 }}><textarea className="pcg-input" rows={2} value={f.notes || ''} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>

      {loan.status === 'open' && remaining > 0 && (
        <div style={{ marginTop: 18, padding: 14, background: T.cream, borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 10 }}>Record a Repayment</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
            <Field label={`Amount (max ${fmtMoney(remaining, loan.currency)})`}><input className="pcg-input" type="number" step="0.01" value={repayAmt} onChange={e => setRepayAmt(e.target.value)} /></Field>
            <Field label="Date"><input className="pcg-input" type="date" value={repayDate} onChange={e => setRepayDate(e.target.value)} /></Field>
            <button type="button" className="pcg-btn" onClick={() => { if (repayAmt) { onRepay(repayAmt, new Date(repayDate).toISOString()); } }}>Record</button>
          </div>
        </div>
      )}
    </EditModal>
  );
}

function Accounts({ accounts, ledger, onAdd, onEdit, onDelete }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'Bank', openingBalance: '0', currency: 'BDT' });
  const submit = (e) => {
    e.preventDefault();
    onAdd({ ...form, openingBalance: parseFloat(form.openingBalance) });
    setForm({ name: '', type: 'Bank', openingBalance: '0', currency: 'BDT' });
    setShow(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontFamily: T.serif, fontSize: 19, margin: 0, fontWeight: 500 }}>Accounts</h3>
        <button onClick={() => setShow(!show)} className="pcg-btn"><Plus size={14} /> Add Account</button>
      </div>

      {show && (
        <form onSubmit={submit} className="pcg-card fade-in" style={{ marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <Field label="Account Name"><input className="pcg-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Bank — DBBL" /></Field>
            <Field label="Type"><select className="pcg-input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option>Bank</option><option>bKash</option><option>Cash</option><option>Other</option></select></Field>
            <Field label="Opening Balance"><input className="pcg-input" type="number" step="0.01" value={form.openingBalance} onChange={e => setForm({ ...form, openingBalance: e.target.value })} /></Field>
            <Field label="Currency"><select className="pcg-input" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}><option>BDT</option><option>RM</option></select></Field>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button type="button" className="pcg-btn pcg-btn-secondary" onClick={() => setShow(false)}>Cancel</button>
            <button type="submit" className="pcg-btn">Save Account</button>
          </div>
        </form>
      )}

      <div className="pcg-card" style={{ padding: 0, overflow: 'hidden' }}>
        {accounts.length === 0 ? <div style={{ padding: 36 }}><EmptyState text="No accounts yet." /></div> : accounts.map((a, i) => {
          const movements = ledger.filter(l => l.account === a.name).reduce((s, l) => s + (l.direction === 'in' ? parseFloat(l.amount) : -parseFloat(l.amount)), 0);
          const balance = (parseFloat(a.openingBalance) || 0) + movements;
          return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: i < accounts.length - 1 ? `1px solid ${T.borderSoft}` : 'none' }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: T.cream, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {a.type === 'Bank' ? <Landmark size={15} /> : a.type === 'bKash' ? <Phone size={15} /> : <Wallet size={15} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: T.ink, fontWeight: 500 }}>{a.name}</div>
                <div style={{ fontSize: 11.5, color: T.muted }}>{a.type} · Opening: {fmtMoney(a.openingBalance, a.currency)}</div>
              </div>
              <div style={{ fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 17, color: balance < 0 ? T.terracotta : T.ink }}>{fmtMoney(balance, a.currency)}</div>
              <button onClick={() => onEdit(a)} className="pcg-btn pcg-btn-ghost"><Pencil size={13} /></button>
              <button onClick={() => onDelete(a.id)} className="pcg-btn pcg-btn-ghost"><Trash2 size={13} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccountEditModal({ account, onClose, onSave }) {
  const [f, setF] = useState(account);
  return (
    <EditModal title="Edit Account" onClose={onClose} onSave={() => onSave({ ...f, openingBalance: parseFloat(f.openingBalance) })}>
      <Field label="Account Name"><input className="pcg-input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 12 }}>
        <Field label="Type"><select className="pcg-input" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option>Bank</option><option>bKash</option><option>Cash</option><option>Other</option></select></Field>
        <Field label="Opening Balance"><input className="pcg-input" type="number" step="0.01" value={f.openingBalance} onChange={e => setF({ ...f, openingBalance: e.target.value })} /></Field>
        <Field label="Currency"><select className="pcg-input" value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })}><option>BDT</option><option>RM</option></select></Field>
      </div>
    </EditModal>
  );
}

// ═══════════════════════════════════════════════════════════════════
// INVOICES (with QR code, POS print)
// ═══════════════════════════════════════════════════════════════════
function Receipts({ orders, ledger, company, onShowReceipt, onOpenOrder }) {
  const [search, setSearch] = useState('');
  const deliveredOrders = useMemo(() => {
    return orders
      .filter(o => o.delivered)
      .filter(o => {
        if (!search) return true;
        const q = search.toLowerCase();
        return o.customerName?.toLowerCase().includes(q) || o.orderNumber?.toLowerCase().includes(q) || o.customerPhone?.toLowerCase().includes(q);
      })
      .sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || ''));
  }, [orders, search]);

  const paymentsFor = (orderId) => (ledger || []).filter(l => l.relatedOrderId === orderId && l.direction === 'in' && l.kind !== 'cogs');

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 380 }}>
          <Search size={15} color={T.muted} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
          <input className="pcg-input" placeholder="Search by name, phone, order#" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40, borderRadius: 14 }} />
        </div>
      </div>

      <div className="pcg-card" style={{ padding: 0, overflow: 'hidden' }}>
        {deliveredOrders.length === 0 ? <div style={{ padding: 36 }}><EmptyState text={orders.length === 0 ? "No orders yet." : "No delivered orders yet. Paid receipts appear here automatically when orders are delivered."} /></div> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '170px 140px 1fr 160px 140px 130px', padding: '12px 18px', borderBottom: `1px solid ${T.borderSoft}`, fontSize: 10.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
              <div>Receipt #</div><div>Order #</div><div>Customer</div><div>Total Paid</div><div>Delivered On</div><div></div>
            </div>
            {deliveredOrders.map(o => {
              const pays = paymentsFor(o.id);
              const totalPaid = pays.reduce((s, p) => s + parseFloat(p.amount || 0), 0) || calcOrder(o).selling;
              return (
                <div key={o.id} className="pcg-row" style={{ display: 'grid', gridTemplateColumns: '170px 140px 1fr 160px 140px 130px', padding: '14px 18px', borderBottom: `1px solid ${T.borderSoft}`, alignItems: 'center', fontSize: 13.5 }}>
                  <div style={{ fontFamily: T.serif, fontWeight: 600 }}>RCP-{o.orderNumber}</div>
                  <div style={{ fontFamily: T.sans, fontWeight: 500, color: T.muted }}>{o.orderNumber}</div>
                  <div>
                    <div style={{ color: T.ink, fontWeight: 600 }}>{o.customerName}</div>
                    <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{o.customerPhone || ''}</div>
                  </div>
                  <div style={{ fontFamily: T.serif, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: T.paidRed }}>{fmtBDT(totalPaid)}</div>
                  <div style={{ fontSize: 12.5, color: T.muted }}>{fmtDate(o.orderDate)}</div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => onShowReceipt({ order: o, payments: pays, company })} className="pcg-btn pcg-btn-sm" style={{ background: T.paidRed }}>
                      <Printer size={12} /> Receipt
                    </button>
                    <button onClick={() => onOpenOrder(o)} className="pcg-btn pcg-btn-ghost pcg-btn-sm" title="Open order">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function Invoices({ invoices, onAdd, onPrint, onDelete, company }) {
  const [view, setView] = useState('list');
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, background: T.surface, padding: 5, borderRadius: 10, border: `1px solid ${T.borderSoft}`, width: 'fit-content' }}>
        <button onClick={() => setView('list')} style={tabBtn(view === 'list')}><FileText size={14} /> All Invoices</button>
        <button onClick={() => setView('new')} style={tabBtn(view === 'new')}><Plus size={14} /> Create Invoice</button>
      </div>
      {view === 'list' && <InvoiceList invoices={invoices} onPrint={onPrint} onDelete={onDelete} />}
      {view === 'new' && <NewInvoice onSubmit={(d) => { onAdd(d); setView('list'); }} company={company} />}
    </div>
  );
}

const tabBtn = (active) => ({
  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
  background: active ? T.ink : 'transparent', color: active ? T.cream : T.muted,
  border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer'
});

function InvoiceList({ invoices, onPrint, onDelete }) {
  return (
    <div className="pcg-card" style={{ padding: 0, overflow: 'hidden' }}>
      {invoices.length === 0 ? <div style={{ padding: 36 }}><EmptyState text="No invoices yet. Click 'Create Invoice' to start." /></div> : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 100px 130px 110px', padding: '12px 18px', borderBottom: `1px solid ${T.borderSoft}`, fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>
            <div>Invoice #</div><div>Customer</div><div>Items</div><div style={{ textAlign: 'right' }}>Total</div><div></div>
          </div>
          {invoices.map(inv => (
            <div key={inv.id} className="pcg-row" onClick={() => onPrint(inv)} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 100px 130px 110px', padding: '14px 18px', borderBottom: `1px solid ${T.borderSoft}`, alignItems: 'center', fontSize: 13 }}>
              <div>
                <div style={{ fontFamily: T.serif, fontWeight: 500 }}>{inv.invoiceNumber}</div>
                <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {fmtDate(inv.date)}
                  {inv.autoGenerated && <span style={{ background: T.olive + '20', color: T.olive, padding: '1px 5px', borderRadius: 3, fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>From Order</span>}
                </div>
              </div>
              <div><div style={{ color: T.ink, fontWeight: 500 }}>{inv.customer?.name || '—'}</div><div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{inv.customer?.phone || ''}</div></div>
              <div style={{ color: T.muted }}>{inv.items.length} item{inv.items.length !== 1 ? 's' : ''}</div>
              <div style={{ textAlign: 'right', fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 15 }}>{fmtBDT(inv.total)}</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }} onClick={e => e.stopPropagation()}>
                <button onClick={() => onPrint(inv)} className="pcg-btn pcg-btn-ghost"><Eye size={13} /></button>
                <button onClick={() => onDelete(inv.id)} className="pcg-btn pcg-btn-ghost"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewInvoice({ onSubmit, company }) {
  const [step, setStep] = useState(1); // 1: ask rate, 2: fill items
  const [rate, setRate] = useState('50');
  const [customer, setCustomer] = useState({ name: '', phone: '', address: '' });
  const [items, setItems] = useState([{ id: uid(), name: '', costRM: '', rate: '50', qty: 1 }]);
  const [discount, setDiscount] = useState('0');
  const [notes, setNotes] = useState('');

  const addItem = () => setItems([...items, { id: uid(), name: '', costRM: '', rate: rate, qty: 1 }]);
  const updateItem = (id, key, val) => setItems(items.map(i => i.id === id ? { ...i, [key]: val } : i));
  const removeItem = (id) => setItems(items.filter(i => i.id !== id));

  const itemsWithTotals = items.map(i => ({
    ...i,
    totalBDT: (parseFloat(i.costRM) || 0) * (parseFloat(i.rate) || 0) * (parseFloat(i.qty) || 1)
  }));
  const subtotal = itemsWithTotals.reduce((s, i) => s + i.totalBDT, 0);
  const total = Math.max(0, subtotal - (parseFloat(discount) || 0));

  const submit = () => {
    if (!customer.name) return alert('Please enter customer name.');
    if (itemsWithTotals.every(i => !i.name || !i.totalBDT)) return alert('Please add at least one item.');
    onSubmit({
      date: new Date().toISOString(), customer,
      items: itemsWithTotals.filter(i => i.name && i.totalBDT > 0),
      defaultRate: parseFloat(rate), subtotal,
      discount: parseFloat(discount) || 0, total, notes
    });
  };

  if (step === 1) {
    return (
      <div className="pcg-card" style={{ maxWidth: 480 }}>
        <h3 style={{ fontFamily: T.serif, fontSize: 20, margin: '0 0 6px', fontWeight: 500 }}>Set Conversion Rate</h3>
        <p style={{ fontSize: 13, color: T.muted, marginBottom: 18 }}>This rate converts RM to BDT and already includes your profit margin. You can override it per item later.</p>
        <Field label="RM → BDT Rate (incl. margin)">
          <input className="pcg-input" type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)} style={{ fontFamily: T.serif, fontSize: 22 }} />
        </Field>
        <div style={{ marginTop: 8, padding: 12, background: T.cream, borderRadius: 8, fontSize: 12, color: T.muted }}>
          <strong style={{ color: T.ink }}>Example:</strong> An item costing RM 10 with rate {rate} → BDT {(10 * parseFloat(rate || 0)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </div>
        <button onClick={() => { setItems(items.map(i => ({ ...i, rate }))); setStep(2); }} className="pcg-btn" style={{ marginTop: 18 }}>Continue <ChevronRight size={14} /></button>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18 }}>
      <div className="pcg-card">
        <Section title="Customer">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Name *"><input className="pcg-input" value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} /></Field>
            <Field label="Phone"><input className="pcg-input" value={customer.phone} onChange={e => setCustomer({ ...customer, phone: e.target.value })} /></Field>
          </div>
          <Field label="Address" style={{ marginTop: 10 }}><input className="pcg-input" value={customer.address} onChange={e => setCustomer({ ...customer, address: e.target.value })} /></Field>
        </Section>

        <Section title={`Items (rate: ${rate} BDT per RM)`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 70px 70px 110px 32px', gap: 8, marginBottom: 8, fontSize: 10.5, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, padding: '0 4px' }}>
            <div>Item Name</div><div>RM</div><div>Rate</div><div>Qty</div><div style={{ textAlign: 'right' }}>Total (BDT)</div><div></div>
          </div>
          {items.map(i => {
            const total = (parseFloat(i.costRM) || 0) * (parseFloat(i.rate) || 0) * (parseFloat(i.qty) || 1);
            return (
              <div key={i.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 70px 70px 110px 32px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <input className="pcg-input" value={i.name} onChange={e => updateItem(i.id, 'name', e.target.value)} placeholder="Item name" />
                <input className="pcg-input" type="number" step="0.01" value={i.costRM} onChange={e => updateItem(i.id, 'costRM', e.target.value)} placeholder="0" />
                <input className="pcg-input" type="number" step="0.01" value={i.rate} onChange={e => updateItem(i.id, 'rate', e.target.value)} />
                <input className="pcg-input" type="number" min="1" value={i.qty} onChange={e => updateItem(i.id, 'qty', e.target.value)} />
                <div style={{ textAlign: 'right', fontFamily: T.serif, fontWeight: 500, fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>{fmtBDT(total)}</div>
                <button onClick={() => removeItem(i.id)} className="pcg-btn pcg-btn-ghost" disabled={items.length === 1}><X size={14} /></button>
              </div>
            );
          })}
          <button type="button" onClick={addItem} className="pcg-btn pcg-btn-secondary" style={{ marginTop: 6, fontSize: 12 }}><Plus size={13} /> Add Item</button>
        </Section>

        <Section title="Discount & Notes" last>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10 }}>
            <Field label="Discount (BDT)"><input className="pcg-input" type="number" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)} /></Field>
            <Field label="Notes"><input className="pcg-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional message on invoice" /></Field>
          </div>
        </Section>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={() => setStep(1)} className="pcg-btn pcg-btn-secondary">Back</button>
          <button onClick={submit} className="pcg-btn">Generate Invoice <ChevronRight size={14} /></button>
        </div>
      </div>

      <div>
        <div className="pcg-card" style={{ position: 'sticky', top: 20, background: T.ink, color: T.cream, border: 'none' }}>
          <div style={{ fontSize: 11, color: T.cream + '99', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>Invoice Total</div>
          <div style={{ fontFamily: T.serif, fontSize: 36, fontWeight: 500, letterSpacing: '-0.02em', margin: '8px 0 4px', fontVariantNumeric: 'tabular-nums' }}>{fmtBDT(total)}</div>
          <div style={{ fontSize: 12, color: T.cream + 'AA', marginBottom: 16 }}>{company.displayName} · {itemsWithTotals.filter(i => i.totalBDT > 0).length} item{itemsWithTotals.filter(i => i.totalBDT > 0).length !== 1 ? 's' : ''}</div>
          <div style={{ height: 1, background: T.cream + '22', margin: '12px 0' }} />
          <PreviewRow label="Subtotal" value={fmtBDT(subtotal)} />
          <PreviewRow label="Discount" value={`− ${fmtBDT(parseFloat(discount) || 0)}`} muted />
          <div style={{ height: 1, background: T.cream + '22', margin: '8px 0' }} />
          <PreviewRow label="Total Payable" value={fmtBDT(total)} bold />
        </div>
      </div>
    </div>
  );
}

function InvoicePrintModal({ invoice, company, onClose, onUpdate }) {
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState(invoice);

  // QR code: encode invoice summary
  const qrPayload = `${company.displayName}\n${invoice.invoiceNumber}\n${fmtDate(invoice.date)}\nCustomer: ${invoice.customer?.name || ''}\n${invoice.items.map(i => `${i.name} - ${fmtBDT(i.totalBDT)}`).join('\n')}\nTotal: ${fmtBDT(invoice.total)}\nContact: ${company.contact}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrPayload)}`;

  const handlePrint = () => window.print();

  const saveEdits = () => {
    onUpdate(invoice.id, form);
    setEditMode(false);
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, backdropFilter: 'blur(6px)', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} className="fade-in" style={{ background: T.cream, borderRadius: 14, width: '100%', maxWidth: 720, maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="no-print" style={{ padding: '16px 22px', borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 5 }}>
          <h3 style={{ fontFamily: T.serif, fontSize: 19, margin: 0, fontWeight: 500 }}>Invoice {invoice.invoiceNumber}</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setEditMode(!editMode)} className="pcg-btn pcg-btn-secondary"><Pencil size={13} /> {editMode ? 'Cancel' : 'Edit'}</button>
            {editMode && <button onClick={saveEdits} className="pcg-btn"><Save size={13} /> Save</button>}
            <button onClick={handlePrint} className="pcg-btn"><Printer size={13} /> Print</button>
            <button onClick={onClose} className="pcg-btn pcg-btn-ghost"><X size={20} /></button>
          </div>
        </div>

        {editMode ? (
          <div style={{ padding: 22 }}>
            <Field label="Customer Name"><input className="pcg-input" value={form.customer?.name || ''} onChange={e => setForm({ ...form, customer: { ...form.customer, name: e.target.value } })} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
              <Field label="Phone"><input className="pcg-input" value={form.customer?.phone || ''} onChange={e => setForm({ ...form, customer: { ...form.customer, phone: e.target.value } })} /></Field>
              <Field label="Address"><input className="pcg-input" value={form.customer?.address || ''} onChange={e => setForm({ ...form, customer: { ...form.customer, address: e.target.value } })} /></Field>
            </div>
            <Field label="Notes" style={{ marginTop: 10 }}><textarea className="pcg-input" rows={2} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
            <Field label="Discount (BDT)" style={{ marginTop: 10 }}><input className="pcg-input" type="number" value={form.discount} onChange={e => {
              const d = parseFloat(e.target.value) || 0;
              setForm({ ...form, discount: d, total: Math.max(0, form.subtotal - d) });
            }} /></Field>
            <div style={{ marginTop: 14, padding: 12, background: T.surface, borderRadius: 8, fontSize: 12, color: T.muted }}>To edit individual items, please delete and recreate the invoice. (We keep this simple to avoid breaking totals.)</div>
          </div>
        ) : (
          <div className="print-area" style={{ padding: '28px 32px', background: 'white', fontFamily: T.sans }}>
            <InvoicePrintable invoice={invoice} company={company} qrUrl={qrUrl} />
          </div>
        )}
      </div>
    </div>
  );
}

function InvoicePrintable({ invoice, company, qrUrl }) {
  // Connect invoice number to its source order number for traceability
  const orderRef = invoice.relatedOrderId ? (invoice.invoiceNumber.includes('INV-')
    ? invoice.invoiceNumber.replace('-INV', '')
    : '') : '';
  // Barcode encodes the invoice number — barcodeapi.org returns a clean Code128 PNG
  const barcodeUrl = `https://barcodeapi.org/api/code128/${encodeURIComponent(invoice.invoiceNumber)}`;

  return (
    <div style={{ color: '#111', fontSize: 12.5, lineHeight: 1.55, fontFamily: T.sans }}>
      {/* HEADER — Brand left, Invoice meta right */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #111', paddingBottom: 16, marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: T.serif, fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>{company.displayName}</div>
          <div style={{ fontSize: 11.5, marginTop: 8, color: '#555' }}>{company.address}</div>
          <div style={{ fontSize: 11.5, color: '#555' }}>{company.contact}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>Sales Invoice</div>
          <div style={{ fontFamily: T.serif, fontSize: 24, fontWeight: 700, marginTop: 4, letterSpacing: '-0.01em' }}>{invoice.invoiceNumber}</div>
          <div style={{ fontSize: 11.5, color: '#555', marginTop: 6 }}>Date: {fmtDate(invoice.date)}</div>
          {invoice.relatedOrderId && <div style={{ fontSize: 11.5, color: '#555' }}>Order Ref: {invoice.invoiceNumber.replace('-INV-', '-')}</div>}
        </div>
      </div>

      {/* BILL TO — Amazon-style customer block */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 30, marginBottom: 22 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10.5, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 6 }}>Bill To</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 4 }}>{invoice.customer?.name}</div>
          {invoice.customer?.phone && <div style={{ fontSize: 12, color: '#555' }}>{invoice.customer.phone}</div>}
          {invoice.customer?.address && <div style={{ fontSize: 12, color: '#555' }}>{invoice.customer.address}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10.5, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 6 }}>Total Due</div>
          <div style={{ fontFamily: T.serif, fontSize: 26, fontWeight: 700, color: '#111', fontVariantNumeric: 'tabular-nums' }}>{fmtBDT(invoice.total)}</div>
        </div>
      </div>

      {/* ITEMS TABLE — SL # | Description | Price | Qty | Amount */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginBottom: 14 }}>
        <thead>
          <tr style={{ background: '#111', color: '#fff' }}>
            <th style={{ textAlign: 'left', padding: '10px 10px', fontWeight: 700, width: 42, fontSize: 11, letterSpacing: '0.04em' }}>SL #</th>
            <th style={{ textAlign: 'left', padding: '10px 10px', fontWeight: 700, fontSize: 11, letterSpacing: '0.04em' }}>DESCRIPTION</th>
            <th style={{ textAlign: 'right', padding: '10px 10px', fontWeight: 700, width: 90, fontSize: 11, letterSpacing: '0.04em' }}>PRICE</th>
            <th style={{ textAlign: 'center', padding: '10px 10px', fontWeight: 700, width: 50, fontSize: 11, letterSpacing: '0.04em' }}>QTY</th>
            <th style={{ textAlign: 'right', padding: '10px 10px', fontWeight: 700, width: 100, fontSize: 11, letterSpacing: '0.04em' }}>AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((i, idx) => {
            const qty = Number(i.qty) || 1;
            const unitPrice = qty > 0 ? Number(i.totalBDT) / qty : Number(i.totalBDT);
            return (
              <tr key={idx} style={{ borderBottom: '1px solid #E5E5E5' }}>
                <td style={{ padding: '12px 10px', verticalAlign: 'top', color: '#555', fontWeight: 600 }}>{idx + 1}</td>
                <td style={{ padding: '12px 10px', verticalAlign: 'top', color: '#111' }}>{i.name}</td>
                <td style={{ padding: '12px 10px', textAlign: 'right', verticalAlign: 'top', fontVariantNumeric: 'tabular-nums', color: '#444' }}>{Number(unitPrice).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                <td style={{ padding: '12px 10px', textAlign: 'center', verticalAlign: 'top', color: '#444' }}>{qty}</td>
                <td style={{ padding: '12px 10px', textAlign: 'right', verticalAlign: 'top', fontVariantNumeric: 'tabular-nums', color: '#111', fontWeight: 600 }}>{Number(i.totalBDT).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* TOTALS */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <div style={{ minWidth: 300 }}>
          <TotalRow label="Subtotal" value={fmtBDT(invoice.subtotal)} />
          {invoice.discount > 0 && (
            <TotalRow
              label={invoice.discountType === 'percent' ? `Discount (${invoice.discountValue || ''}%)` : 'Discount'}
              value={`− ${fmtBDT(invoice.discount)}`}
            />
          )}
          <TotalRow label="TOTAL" value={fmtBDT(invoice.total)} big />
        </div>
      </div>

      {invoice.notes && (
        <div style={{ marginTop: 18, padding: '12px 14px', background: '#FAF7F0', borderLeft: '3px solid #111', fontSize: 11.5, color: '#444' }}>
          <strong style={{ color: '#111' }}>Notes:</strong> {invoice.notes}
        </div>
      )}

      {/* BARCODE + QR side by side */}
      <div style={{ marginTop: 28, paddingTop: 18, borderTop: '2px solid #E5E5E5' }}>
        {/* Thank you message */}
        <div style={{ textAlign: 'center', marginBottom: 22, padding: '16px 20px', background: 'linear-gradient(135deg, #f7f9ff 0%, #fff 100%)', border: '1px solid #dbeafe', borderRadius: 10 }}>
          <div style={{ fontFamily: T.sans, fontSize: 16, fontWeight: 800, color: '#111', letterSpacing: '0.01em' }}>Thank you for your purchase!</div>
          <div style={{ fontSize: 14, color: '#C8102E', marginTop: 5, fontWeight: 700 }}>🛍 Happy Shopping ✨</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 7 }}>{company.displayName} · {company.contact}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
          <div style={{ textAlign: 'left' }}>
            <img src={barcodeUrl} alt={`Barcode ${invoice.invoiceNumber}`} style={{ height: 50, display: 'block' }} />
            <div style={{ fontSize: 10, color: '#888', marginTop: 4, letterSpacing: '0.05em' }}>{invoice.invoiceNumber}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <img src={qrUrl} alt="QR Code" style={{ width: 70, height: 70 }} />
            <div style={{ fontSize: 9.5, color: '#888', marginTop: 2 }}>Scan invoice</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TotalRow({ label, value, big }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: big ? '10px 0 0' : '6px 0', fontWeight: big ? 700 : 500, fontSize: big ? 17 : 12.5, borderTop: big ? '2px solid #111' : 'none', marginTop: big ? 6 : 0, color: big ? '#111' : '#555' }}>
      <span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PAID RECEIPT (printed after delivery)
// ═══════════════════════════════════════════════════════════════════
function ReceiptPrintModal({ order, payments, company, onClose }) {
  const c = calcOrder(order);
  // Safety: only count actual money IN from the customer — never COGS or outgoing entries
  const realPayments = (payments || []).filter(p => p.direction !== 'out' && p.kind !== 'cogs');
  const recordedPayments = realPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  // If delivered but no ledger payments recorded (e.g. legacy order), assume order total was paid
  const totalPaid = recordedPayments > 0 ? recordedPayments : c.selling;
  const hasLedgerPayments = realPayments.length > 0;
  const receiptNumber = `RCP-${order.orderNumber}`;
  const issuedDate = new Date().toISOString();

  // QR encodes a brief paid-receipt summary
  const qrPayload = `PAID RECEIPT\n${company.displayName}\nReceipt: ${receiptNumber}\nOrder: ${order.orderNumber}\nCustomer: ${order.customerName}\nTotal Paid: ${fmtBDT(totalPaid)}\nDelivered: ${fmtDate(issuedDate)}\nContact: ${company.contact}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrPayload)}`;

  const handlePrint = () => window.print();

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, backdropFilter: 'blur(6px)', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} className="fade-in" style={{ background: T.cream, borderRadius: 14, width: '100%', maxWidth: 720, maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="no-print" style={{ padding: '16px 22px', borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 5 }}>
          <div>
            <h3 style={{ fontFamily: T.serif, fontSize: 19, margin: 0, fontWeight: 500 }}>Paid Receipt · {receiptNumber}</h3>
            <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>For delivered order {order.orderNumber}</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handlePrint} className="pcg-btn" style={{ background: T.success }}><Printer size={13} /> Print</button>
            <button onClick={onClose} className="pcg-btn pcg-btn-ghost"><X size={20} /></button>
          </div>
        </div>

        <div className="print-area" style={{ padding: '28px 32px', background: 'white', fontFamily: T.sans }}>
          <ReceiptPrintable order={order} payments={realPayments} totalPaid={totalPaid} hasLedgerPayments={hasLedgerPayments} company={company} receiptNumber={receiptNumber} issuedDate={issuedDate} qrUrl={qrUrl} c={c} />
        </div>
      </div>
    </div>
  );
}

function ReceiptPrintable({ order, payments, totalPaid, hasLedgerPayments, company, receiptNumber, issuedDate, qrUrl, c }) {
  const items = Array.isArray(order.items) && order.items.length > 0
    ? order.items.map(it => {
        const r = calcItemSelling(it, order.multiplier || c.multiplier);
        return {
          name: it.productName + (it.productDescription ? ` — ${it.productDescription}` : ''),
          qty: r.qty,
          totalBDT: r.lineSelling
        };
      })
    : [{
        name: order.productName + (order.productDescription ? ` — ${order.productDescription}` : ''),
        qty: 1,
        totalBDT: c.selling
      }];

  const orderTotal = items.reduce((s, it) => s + (Number(it.totalBDT) || 0), 0);
  const barcodeUrl = `https://barcodeapi.org/api/code128/${encodeURIComponent(order.orderNumber)}`;

  return (
    <div style={{ color: '#111', fontSize: 12.5, lineHeight: 1.55, fontFamily: T.sans, position: 'relative' }}>
      {/* PAID stamp watermark — Bold RED */}
      <div style={{
        position: 'absolute', top: 65, right: 0,
        border: `4px solid #C8102E`, color: '#C8102E',
        padding: '10px 28px', borderRadius: 6,
        fontFamily: T.sans, fontSize: 32, fontWeight: 900,
        letterSpacing: '0.18em',
        transform: 'rotate(-12deg)',
        opacity: 0.95,
        textShadow: '0 0 0 #C8102E',
        zIndex: 5,
        background: 'rgba(200,16,46,0.04)'
      }}>
        PAID
      </div>

      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #111', paddingBottom: 16, marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: T.serif, fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>{company.displayName}</div>
          <div style={{ fontSize: 11.5, marginTop: 8, color: '#555' }}>{company.address}</div>
          <div style={{ fontSize: 11.5, color: '#555' }}>{company.contact}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: T.paidRed, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>Paid Receipt</div>
          <div style={{ fontFamily: T.serif, fontSize: 22, fontWeight: 700, marginTop: 4, letterSpacing: '-0.01em' }}>{receiptNumber}</div>
          <div style={{ fontSize: 11.5, color: '#555', marginTop: 6 }}>Issued: {fmtDate(issuedDate)}</div>
          <div style={{ fontSize: 11.5, color: '#555' }}>Order: <strong>{order.orderNumber}</strong></div>
        </div>
      </div>

      {/* CUSTOMER BLOCK */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 30, marginBottom: 22 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10.5, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 6 }}>Received From</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 4 }}>{order.customerName}</div>
          {order.customerPhone && <div style={{ fontSize: 12, color: '#555' }}>{order.customerPhone}</div>}
          {order.customerAddress && <div style={{ fontSize: 12, color: '#555' }}>{order.customerAddress}</div>}
          {order.orderDate && <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>Order placed: {fmtDate(order.orderDate)}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10.5, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 6 }}>Total Paid</div>
          <div style={{ fontFamily: T.serif, fontSize: 26, fontWeight: 700, color: T.paidRed, fontVariantNumeric: 'tabular-nums' }}>{fmtBDT(totalPaid)}</div>
        </div>
      </div>

      {/* ITEMS TABLE */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginBottom: 14 }}>
        <thead>
          <tr style={{ background: '#111', color: '#fff' }}>
            <th style={{ textAlign: 'left', padding: '10px 10px', fontWeight: 700, width: 42, fontSize: 11, letterSpacing: '0.04em' }}>SL #</th>
            <th style={{ textAlign: 'left', padding: '10px 10px', fontWeight: 700, fontSize: 11, letterSpacing: '0.04em' }}>DESCRIPTION</th>
            <th style={{ textAlign: 'right', padding: '10px 10px', fontWeight: 700, width: 90, fontSize: 11, letterSpacing: '0.04em' }}>PRICE</th>
            <th style={{ textAlign: 'center', padding: '10px 10px', fontWeight: 700, width: 50, fontSize: 11, letterSpacing: '0.04em' }}>QTY</th>
            <th style={{ textAlign: 'right', padding: '10px 10px', fontWeight: 700, width: 100, fontSize: 11, letterSpacing: '0.04em' }}>AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => {
            const qty = Number(it.qty) || 1;
            const unitPrice = qty > 0 ? Number(it.totalBDT) / qty : Number(it.totalBDT);
            return (
              <tr key={idx} style={{ borderBottom: '1px solid #E5E5E5' }}>
                <td style={{ padding: '12px 10px', verticalAlign: 'top', color: '#555', fontWeight: 600 }}>{idx + 1}</td>
                <td style={{ padding: '12px 10px', verticalAlign: 'top', color: '#111' }}>{it.name}</td>
                <td style={{ padding: '12px 10px', textAlign: 'right', verticalAlign: 'top', fontVariantNumeric: 'tabular-nums', color: '#444' }}>{Number(unitPrice).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                <td style={{ padding: '12px 10px', textAlign: 'center', verticalAlign: 'top', color: '#444' }}>{qty}</td>
                <td style={{ padding: '12px 10px', textAlign: 'right', verticalAlign: 'top', fontVariantNumeric: 'tabular-nums', color: '#111', fontWeight: 600 }}>{Number(it.totalBDT).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* TOTALS */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <div style={{ minWidth: 300 }}>
          <TotalRow label="Subtotal" value={fmtBDT(c.grossSelling)} />
          {c.discountAmount > 0 && (
            <TotalRow
              label={c.discountType === 'percent' ? `Discount (${c.discountValue}%)` : 'Discount'}
              value={`− ${fmtBDT(c.discountAmount)}`}
            />
          )}
          <TotalRow label="TOTAL PAID" value={fmtBDT(totalPaid)} big />
        </div>
      </div>

      {/* PAYMENT HISTORY */}
      {payments && payments.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 10.5, color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 8 }}>Payment History</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              {payments.map((p, idx) => (
                <tr key={p.id || idx} style={{ borderBottom: '1px solid #EFEFEF' }}>
                  <td style={{ padding: '8px 10px', color: '#111' }}>
                    <div style={{ fontWeight: 600 }}>{p.type}</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{fmtDate(p.date)} · {p.account}</div>
                  </td>
                  <td style={{ textAlign: 'right', padding: '8px 10px', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: T.paidRed }}>
                    {fmtBDT(p.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* BARCODE + QR + FOOTER */}
      <div style={{ marginTop: 28, paddingTop: 18, borderTop: '2px solid #E5E5E5' }}>
        {/* Thank you message — prominent, below receipt */}
        <div style={{ textAlign: 'center', marginBottom: 22, padding: '18px 20px', background: 'linear-gradient(135deg, #fff5f7 0%, #fff 100%)', border: '1px solid #fce4ea', borderRadius: 10 }}>
          <div style={{ fontFamily: T.sans, fontSize: 17, fontWeight: 800, color: '#111', letterSpacing: '0.01em' }}>Thank you for your purchase!</div>
          <div style={{ fontSize: 15, color: '#C8102E', marginTop: 6, fontWeight: 700, letterSpacing: '0.02em' }}>🛍 Happy Shopping ✨</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>{company.displayName} · {company.contact}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
          <div style={{ textAlign: 'left' }}>
            <img src={barcodeUrl} alt={`Barcode ${order.orderNumber}`} style={{ height: 50, display: 'block' }} />
            <div style={{ fontSize: 10, color: '#888', marginTop: 4, letterSpacing: '0.05em' }}>{order.orderNumber}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <img src={qrUrl} alt="QR Code" style={{ width: 70, height: 70 }} />
            <div style={{ fontSize: 9.5, color: '#888', marginTop: 2 }}>Scan receipt</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// POST MAKER — Product Social Media Post Generator (LYKOS-style)
// ═══════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
// POST MAKER — Project-based product image generator
// ═══════════════════════════════════════════════════════════════════

// ColorRow helper
function ColorRow({ label, value, onChange, presets }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
      <div style={{ fontSize: 10, color: '#8A8080', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 58, flexShrink: 0 }}>{label}</div>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
        {presets.map(c => (
          <button key={c} type="button" title={c} onClick={() => onChange(c)} style={{
            width: 18, height: 18, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
            background: c === 'transparent' ? 'repeating-linear-gradient(45deg,#ddd,#ddd 2px,#fff 2px,#fff 5px)' : c,
            border: value === c ? '2px solid #B5482E' : '1.5px solid rgba(0,0,0,0.14)',
            boxShadow: value === c ? '0 0 0 2px rgba(181,72,46,0.25)' : 'none',
            transition: 'all 0.1s',
          }} />
        ))}
        <label title="Custom" style={{ width: 18, height: 18, borderRadius: 4, border: '1.5px dashed #C0B8B0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative', background: value, flexShrink: 0 }}>
          <span style={{ pointerEvents: 'none', fontSize: 9, color: 'rgba(0,0,0,0.4)' }}>+</span>
          <input type="color" value={value === 'transparent' ? '#ffffff' : value} onChange={e => onChange(e.target.value)} style={{ position: 'absolute', opacity: 0, width: '200%', height: '200%', cursor: 'pointer' }} />
        </label>
        <span style={{ fontSize: 9, color: '#A09888', fontFamily: 'monospace' }}>{value?.slice(0,7)}</span>
      </div>
    </div>
  );
}


// Default post colors
const DEFAULT_COLORS = {
  bgColor: '#FFFFFF', productNameColor: '#111111', productNameBg: 'transparent',
  priceColor: '#1B8A5A', priceBg: 'transparent', priceBorderColor: '#1B8A5A',
  limitedOfferColor: '#CC0000', saleTagColor: '#FFFFFF', saleTagBg: '#FF6B35',
  brandNameColor: '#111111', brandBarBg: '#B5482E', brandBarTextColor: '#FFFFFF',
  bottomDividerColor: '#EBEBEB',
  saleTagX: 0, saleTagY: 78,   // draggable position (px from left, px from top of card)
};

const SALE_OPTIONS = [
  { id: 'lazada',   label: 'Lazada Sale',   color: '#FF6B35', icon: '🛒' },
  { id: 'shopee',   label: 'Shopee Sale',   color: '#EE4D2D', icon: '🛍' },
  { id: 'malaysia', label: 'Malaysia Sale', color: '#CC0001', icon: '🇲🇾' },
  { id: 'ready',    label: 'Ready Stock',   color: '#1D4ED8', icon: '📦' },
  { id: 'other',    label: 'Other',         color: '#6D28D9', icon: '🏷' },
];

const PRICE_PRESETS = ['#1B8A5A','#B5482E','#0A7EA4','#111111','#FFFFFF','#D97706','#E11D48','#4F46E5'];
const TEXT_PRESETS  = ['#111111','#333333','#FFFFFF','#1B8A5A','#B5482E','#0A7EA4','#D97706','#E11D48'];
const BG_PRESETS    = ['#FFFFFF','#F7F4EE','#F8F8F8','#0F0F0F','#0F172A','#1C1C1C','transparent'];
const TAG_PRESETS   = ['#FF6B35','#EE4D2D','#CC0001','#1D4ED8','#6D28D9','#B5482E','#111111','#FFFFFF'];

// ── Single post card renderer (pure DOM, used for both preview and download) ──
function buildCardHTML(post, company) {
  const { colors, productName, price, onSale, saleType, customSaleLabel, offerEnds } = post;
  const sale = SALE_OPTIONS.find(s => s.id === saleType);
  const fmtPrice = (p) => { const n = parseInt(p); return isNaN(n) ? p : n.toLocaleString('en-IN'); };
  const fmtOfferEnds = (dt) => {
    if (!dt) return '';
    try { return new Date(dt).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true }); }
    catch { return dt; }
  };
  const isDark = ['#0F0F0F','#0F172A','#1C1C1C','#111111'].includes(colors.bgColor);
  const saleLabel = saleType === 'other' ? (customSaleLabel || 'Special') : (sale?.label || '');
  const bg = colors.bgColor === 'transparent' ? '#fff' : colors.bgColor;

  // Build the image section HTML based on screenshots + layout
  const shots = (post.screenshots || []).filter(Boolean);
  const layout = post.layout || 'single';
  let imageSection = '';
  if (post.imgMode === 'screenshot' && shots.length > 1) {
    if (layout === 'duo' && shots.length >= 2) {
      imageSection = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;width:420px;">
        ${shots.slice(0,2).map(s => `<img src="${s.src}" style="width:100%;height:220px;object-fit:cover;display:block;" />`).join('')}
      </div>`;
    } else if (layout === 'trio' && shots.length >= 3) {
      imageSection = `<div style="width:420px;">
        <img src="${shots[0].src}" style="width:100%;height:160px;object-fit:cover;display:block;" />
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:3px;">
          ${shots.slice(1,3).map(s => `<img src="${s.src}" style="width:100%;height:110px;object-fit:cover;display:block;" />`).join('')}
        </div>
      </div>`;
    } else if (layout === 'quad' && shots.length >= 4) {
      imageSection = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;width:420px;">
        ${shots.slice(0,4).map(s => `<img src="${s.src}" style="width:100%;height:135px;object-fit:cover;display:block;" />`).join('')}
      </div>`;
    } else {
      const main = shots[post.activeScreenshot || 0] || shots[0];
      imageSection = `<div style="background:${bg};display:flex;align-items:center;justify-content:center;padding:28px 24px 16px;">
        <img src="${main.src}" style="max-width:88%;max-height:250px;object-fit:contain;filter:drop-shadow(0 12px 28px rgba(0,0,0,0.22));" />
      </div>`;
    }
    imageSection = `<div style="background:${bg};">${imageSection}</div>`;
  } else {
    const imgSrc = (post.imgMode === 'screenshot' && shots[0]?.src) || post.imageUrl || '';
    imageSection = `<div style="background:${bg};min-height:260px;display:flex;align-items:center;justify-content:center;padding:28px 24px 16px;">
      ${imgSrc ? `<img src="${imgSrc}" style="max-width:88%;max-height:250px;object-fit:contain;filter:drop-shadow(0 12px 28px rgba(0,0,0,0.22));" crossOrigin="anonymous" />` : `<div style="width:200px;height:200px;border-radius:12px;background:#F0F0F0;display:flex;align-items:center;justify-content:center;color:#BBB;font-size:13px;">No image</div>`}
    </div>`;
  }

  return `
    <div style="
      width:420px; font-family:'Fraunces',Georgia,serif;
      background:${bg}; overflow:hidden; position:relative;
      border:${isDark ? 'none' : '1px solid #E0E0E0'};
    ">
      <div style="background:${colors.brandBarBg};padding:9px 18px;display:flex;justify-content:space-between;align-items:center;">
        <div style="color:${colors.brandBarTextColor};font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">@${(company.displayName || '').toLowerCase().replace(/\s+/g,'')}</div>
        <div style="color:${colors.brandBarTextColor};font-size:10px;opacity:0.85;">${company.contact}</div>
      </div>
      <div style="padding:13px 18px 10px;text-align:center;background:${colors.productNameBg === 'transparent' ? 'transparent' : colors.productNameBg};border-bottom:1px solid ${colors.bottomDividerColor};">
        <div style="font-size:15px;font-weight:700;color:${colors.productNameColor};letter-spacing:0.02em;text-transform:uppercase;">${productName || 'PRODUCT NAME'}</div>
      </div>
      ${onSale && saleLabel ? `<div style="position:absolute;top:${colors.saleTagY||78}px;left:${colors.saleTagX||0}px;z-index:20;background:${colors.saleTagBg};color:${colors.saleTagColor};padding:5px 14px 5px 10px;font-size:11px;font-weight:800;border-radius:${(colors.saleTagX||0)<10?'0 6px 6px 0':'6px'};letter-spacing:0.05em;text-transform:uppercase;">${sale?.icon || '🏷'} ${saleLabel}</div>` : ''}
      ${imageSection}
      <div style="padding:6px 18px 4px;text-align:center;background:${colors.priceBg === 'transparent' ? 'transparent' : colors.priceBg};">
        <div style="font-size:27px;font-weight:900;letter-spacing:0.04em;color:${colors.priceColor};text-transform:uppercase;${colors.priceBorderColor && colors.priceBorderColor !== 'transparent' ? `display:inline-block;border:2px solid ${colors.priceBorderColor};border-radius:10px;padding:4px 18px;` : ''}">PRICE - ${fmtPrice(price) || '0'} TAKA</div>
      </div>
      <div style="text-align:center;padding:3px 18px 10px;">
        ${onSale && offerEnds ? `<div style="font-size:10px;color:${colors.limitedOfferColor};font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">OFFER ENDS ${fmtOfferEnds(offerEnds)}</div>` : onSale ? `<div style="font-size:10px;color:${colors.limitedOfferColor};font-weight:600;letter-spacing:0.1em;text-transform:uppercase;">LIMITED TIME OFFER</div>` : ''}
      </div>
      <div style="padding:10px 18px 13px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid ${colors.bottomDividerColor};">
        <div style="font-size:9px;color:${colors.brandNameColor};opacity:0.6;">@${(company.displayName || '').toLowerCase().replace(/\s+/g,'')}</div>
        <div style="font-size:23px;font-weight:700;color:${colors.brandNameColor};letter-spacing:0.08em;font-style:italic;text-align:center;flex:1;">${company.displayName}</div>
        <div style="font-size:9px;color:${colors.brandNameColor};opacity:0.6;text-align:right;">${company.contact}</div>
      </div>
    </div>
  `;
}

function PostMaker({ company, showToast }) {
  // Project layer
  const [project, setProject] = useState(null); // null = no active project (show create screen)
  const [posts, setPosts] = useState([]);         // array of post objects
  const [activePostId, setActivePostId] = useState(null);

  // Form for creating new post within project
  const blankPost = () => ({
    id: uid(),
    imgMode: 'url',
    productUrl: '', productName: '', price: '',
    onSale: false, saleType: '', customSaleLabel: '', offerEnds: '',
    imageUrl: '', manualImageUrl: '',
    screenshots: [],      // array of { id, src } — multiple screenshots
    activeScreenshot: 0,  // index of the one used as main image
    layout: 'single',     // 'single' | 'duo' | 'trio' | 'quad'
    colors: { ...DEFAULT_COLORS },
    downloading: false,
    downloaded: false,
  });

  const [editForm, setEditForm] = useState(blankPost());
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [captionCopied, setCaptionCopied] = useState(false);

  // Project creation form — with date range
  const today = new Date().toISOString().slice(0,10);
  const [projForm, setProjForm] = useState({ name: '', dateFrom: today, dateTo: today, note: '' });

  const activePost = posts.find(p => p.id === activePostId);
  const setC = (key) => (val) => setEditForm(f => ({ ...f, colors: { ...f.colors, [key]: val } }));

  const fetchImage = async () => {
    if (!editForm.productUrl) return;
    setLoading(true); setFetchError('');
    const url = editForm.productUrl;
    const proxies = [
      `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
      `https://corsproxy.io/?${encodeURIComponent(url)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    ];
    let html = '';
    for (const proxy of proxies) {
      try {
        const res = await fetch(proxy);
        if (!res.ok) continue;
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json')) {
          const data = await res.json();
          html = data.contents || data.body || '';
        } else {
          html = await res.text();
        }
        if (html.length > 100) break;
      } catch { continue; }
    }
    if (!html) {
      setFetchError("Couldn't reach the page. Try the Image URL or Screenshot tab instead.");
      setLoading(false); return;
    }
    const imgPatterns = [
      /property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']/i,
      /content=["\']([^"\']+)["\'][^>]*property=["\']og:image["\']/i,
      /name=["\']twitter:image["\'][^>]*content=["\']([^"\']+)["\']/i,
      /content=["\']([^"\']+)["\'][^>]*name=["\']twitter:image["\']/i,
      /"image"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i,
    ];
    const titlePatterns = [
      /property=["\']og:title["\'][^>]*content=["\']([^"\']+)["\']/i,
      /content=["\']([^"\']+)["\'][^>]*property=["\']og:title["\']/i,
      /<title[^>]*>([^<]+)<\/title>/i,
    ];
    let imgUrl = '';
    for (const p of imgPatterns) { const m = html.match(p); if (m?.[1] && m[1].startsWith('http')) { imgUrl = m[1]; break; } }
    let title = '';
    for (const p of titlePatterns) { const m = html.match(p); if (m?.[1]) { title = m[1].replace(/\s*[\|\-\u2013\u2014].*$/, '').trim().slice(0, 70); break; } }
    if (imgUrl) {
      setEditForm(f => ({ ...f, imageUrl: imgUrl, productName: f.productName || title }));
      setFetchError('');
    } else {
      setFetchError("Page loaded but couldn't extract a product image. Right-click the product photo → 'Copy image address' → switch to Image URL tab.");
    }
    setLoading(false);
  };

  const activeImage = editForm.imgMode === 'screenshot'
    ? (editForm.screenshots?.[editForm.activeScreenshot || 0]?.src || '')
    : (editForm.manualImageUrl || editForm.imageUrl);


  const addPostToProject = () => {
    if (!activeImage && !editForm.productName) return showToast('Add at least a product name or image', 'error');
    if (!editForm.price) return showToast('Enter a price', 'error');
    const newPost = { ...editForm, imageUrl: activeImage, id: uid(), downloaded: false };
    setPosts(prev => [...prev, newPost]);
    setActivePostId(newPost.id);
    setEditForm(blankPost());
    setFetchError('');
    showToast('Post added to project!');
  };

  // Download a single post as PNG using Canvas
  const downloadPost = async (post) => {
    const imgUrl = post.imageUrl;
    // Build an offscreen container, use html2canvas-style via a blob URL approach
    // Since we can't use html2canvas without npm, we'll use a print window approach
    // that saves as PNG via the browser's built-in capability
    setPosts(prev => prev.map(p => p.id === post.id ? { ...p, downloading: true } : p));
    try {
      // Create a canvas from the card using a temporary window
      const cardHtml = buildCardHTML(post, company);
      const win = window.open('', '_blank', 'width=500,height=700');
      win.document.write(`<!DOCTYPE html><html><head>
        <title>Download - ${post.productName || 'Post'}</title>
        <script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js"><\/script>
        <style>*{box-sizing:border-box;margin:0;padding:0;}body{background:#f0f0f0;display:flex;align-items:center;justify-content:center;padding:20px;min-height:100vh;}</style>
        </head><body>
        <div id="card">${cardHtml}<\/div>
        <script>
          window.onload = function() {
            html2canvas(document.getElementById("card"), {
              scale: 3, useCORS: true, allowTaint: true,
              backgroundColor: null, logging: false
            }).then(function(canvas) {
              var link = document.createElement("a");
              link.download = "${(post.productName || 'product').replace(/[^a-zA-Z0-9]/g,'_')}.png";
              link.href = canvas.toDataURL("image/png");
              link.click();
              setTimeout(function() { window.close(); }, 500);
            });
          };
        <\/script>
        </body></html>`);
      win.document.close();
      setTimeout(() => {
        setPosts(prev => prev.map(p => p.id === post.id ? { ...p, downloading: false, downloaded: true } : p));
      }, 3000);
    } catch(e) {
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, downloading: false } : p));
      showToast('Download failed — try screenshot', 'error');
    }
  };

  const downloadAll = () => posts.forEach(p => setTimeout(() => downloadPost(p), 300));

  const removePost = (id) => {
    setPosts(prev => prev.filter(p => p.id !== id));
    if (activePostId === id) setActivePostId(posts.find(p => p.id !== id)?.id || null);
  };

  const fmtPriceDisplay = (p) => { const n = parseInt(p); return isNaN(n) ? p : n.toLocaleString('en-IN'); };
  const fmtOfferEnds = (dt) => {
    if (!dt) return '';
    try { return new Date(dt).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true }); }
    catch { return dt; }
  };

  // ═════════════════════════════════
  // PHASE 1: No project yet → Create
  // ═════════════════════════════════
  if (!project) {
    // Build a 30-day calendar strip for visual date range selection
    const stripDays = 42; // 6 weeks
    const stripBase = new Date(); stripBase.setDate(stripBase.getDate() - 7);
    const calDays = Array.from({ length: stripDays }, (_, i) => {
      const d = new Date(stripBase); d.setDate(d.getDate() + i);
      return d.toISOString().slice(0,10);
    });
    const isInRange = (d) => projForm.dateFrom && projForm.dateTo && d >= projForm.dateFrom && d <= projForm.dateTo;
    const isStart = (d) => d === projForm.dateFrom;
    const isEnd = (d) => d === projForm.dateTo;
    const dayLabel = (d) => new Date(d + 'T00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short' });
    const rangeDays = projForm.dateFrom && projForm.dateTo
      ? Math.round((new Date(projForm.dateTo) - new Date(projForm.dateFrom)) / 86400000) + 1 : 0;

    return (
      <div style={{ maxWidth: 580, margin: '0 auto', paddingTop: 16 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontFamily: T.serif, fontSize: 36, fontWeight: 500, letterSpacing: '-0.02em', color: T.ink, marginBottom: 6 }}>New Project</div>
          <div style={{ fontSize: 13.5, color: T.muted, lineHeight: 1.6 }}>
            Create a project for a sale or collection. <strong style={{ color: T.ink }}>Not saved</strong> — download images before leaving.
          </div>
        </div>

        <div className="pcg-card" style={{ padding: 24 }}>
          <Field label="Project Name">
            <input className="pcg-input" value={projForm.name} onChange={e => setProjForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Eid Sale 2025 — PUMA Collection" autoFocus />
          </Field>

          {/* Date range with visual calendar strip */}
          <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <Field label="From" style={{ flex: 1 }}>
                <input className="pcg-input" type="date" value={projForm.dateFrom}
                  onChange={e => setProjForm(f => ({ ...f, dateFrom: e.target.value, dateTo: f.dateTo < e.target.value ? e.target.value : f.dateTo }))} />
              </Field>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 10, color: T.muted, fontSize: 18 }}>→</div>
              <Field label="To" style={{ flex: 1 }}>
                <input className="pcg-input" type="date" value={projForm.dateTo} min={projForm.dateFrom}
                  onChange={e => setProjForm(f => ({ ...f, dateTo: e.target.value }))} />
              </Field>
            </div>

            {/* Visual calendar strip */}
            <div style={{ background: T.cream, borderRadius: 10, padding: '12px 10px', border: `1px solid ${T.borderSoft}` }}>
              <div style={{ fontSize: 10.5, color: T.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>📅 Visual Date Range</span>
                {rangeDays > 0 && <span style={{ color: T.terracotta, fontWeight: 700 }}>{rangeDays} day{rangeDays !== 1 ? 's' : ''} selected</span>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {calDays.map(d => {
                  const inRange = isInRange(d);
                  const start = isStart(d);
                  const end = isEnd(d);
                  const todayD = today;
                  const isToday = d === todayD;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        if (!projForm.dateFrom || (projForm.dateFrom && projForm.dateTo && projForm.dateFrom !== projForm.dateTo)) {
                          setProjForm(f => ({ ...f, dateFrom: d, dateTo: d }));
                        } else if (d >= projForm.dateFrom) {
                          setProjForm(f => ({ ...f, dateTo: d }));
                        } else {
                          setProjForm(f => ({ ...f, dateFrom: d }));
                        }
                      }}
                      title={dayLabel(d)}
                      style={{
                        width: 32, height: 32, borderRadius: start || end ? 8 : inRange ? 4 : 6,
                        border: isToday && !inRange ? `2px solid ${T.terracotta}` : 'none',
                        background: start || end ? T.terracotta : inRange ? '#EFDED7' : T.surface,
                        color: start || end ? '#fff' : inRange ? T.terracotta : T.ink,
                        cursor: 'pointer', fontSize: 10.5, fontWeight: start || end ? 700 : isToday ? 600 : 400,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.12s', lineHeight: 1.2, padding: '2px 0',
                        boxShadow: start || end ? '0 2px 8px rgba(181,72,46,0.35)' : 'none',
                      }}
                    >
                      <span>{new Date(d + 'T00:00').getDate()}</span>
                      {(start || end || isToday) && <span style={{ fontSize: 7.5, opacity: 0.8 }}>{new Date(d + 'T00:00').toLocaleDateString('en',{month:'short'})}</span>}
                    </button>
                  );
                })}
              </div>
              {rangeDays > 0 && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: T.muted, textAlign: 'center' }}>
                  <strong style={{ color: T.ink }}>{dayLabel(projForm.dateFrom)}</strong> → <strong style={{ color: T.ink }}>{dayLabel(projForm.dateTo)}</strong>
                  {rangeDays === 1 ? ' (1 day)' : ` (${rangeDays} days)`}
                </div>
              )}
            </div>
          </div>

          <Field label="Notes (optional)" style={{ marginTop: 16 }}>
            <input className="pcg-input" value={projForm.note} onChange={e => setProjForm(f => ({ ...f, note: e.target.value }))} placeholder="e.g. 10 products on Lazada sale, ends June 30" />
          </Field>

          <button
            onClick={() => {
              if (!projForm.name.trim()) return showToast('Enter a project name', 'error');
              setProject({ ...projForm, date: projForm.dateFrom, createdAt: new Date().toISOString() });
              setPosts([]);
            }}
            className="pcg-btn"
            style={{ width: '100%', justifyContent: 'center', marginTop: 22, padding: '12px', fontSize: 15 }}
          >
            Create Project →
          </button>
        </div>

        <div style={{ marginTop: 16, padding: '11px 15px', background: T.cream, borderRadius: 10, fontSize: 12, color: T.muted, lineHeight: 1.7, border: `1px solid ${T.borderSoft}` }}>
          <strong style={{ color: T.ink }}>How it works:</strong> Create a project per sale/collection. Add products, design each one with colors & sale tags, then download all as PNG — ready to post on Facebook or Instagram.
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════
  // ═════════════════════════════════════════
  // PHASE 2: Active project → Build & Design
  // ═════════════════════════════════════════
  const sale = SALE_OPTIONS.find(s => s.id === editForm.saleType);

  // Edit existing post back into form
  const editPost = (post) => {
    setEditForm({ ...post, _editingId: post.id });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const isEditing = !!editForm._editingId;
  const saveEdit = () => {
    if (!editForm.price) return showToast('Enter a price', 'error');
    const img = editForm.imgMode === 'screenshot'
      ? ((editForm.screenshots||[]).filter(Boolean)[editForm.activeScreenshot||0]?.src || (editForm.screenshots||[]).filter(Boolean)[0]?.src || '')
      : (editForm.manualImageUrl || editForm.imageUrl);
    setPosts(prev => prev.map(p => p.id === editForm._editingId ? { ...editForm, imageUrl: img, _editingId: undefined } : p));
    setEditForm(blankPost()); setFetchError('');
    showToast('Design updated!');
  };
  const cancelEdit = () => { setEditForm(blankPost()); setFetchError(''); };

  return (
    <div>
      {/* Project header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, padding: '14px 18px', background: T.surface, borderRadius: 12, border: `1px solid ${T.borderSoft}` }}>
        <div>
          <div style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 500, color: T.ink }}>{project.name}</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 3 }}>
            {fmtDate(project.dateFrom || project.date)}{project.dateTo && project.dateTo !== (project.dateFrom || project.date) ? ` → ${fmtDate(project.dateTo)}` : ''} · {posts.length} image{posts.length !== 1 ? 's' : ''}
            {project.note && <span> · {project.note}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {posts.length > 0 && <button onClick={downloadAll} className="pcg-btn" style={{ background: T.success }}><Download size={14} /> Download All ({posts.length})</button>}
          <button onClick={() => { if (window.confirm('End project? Work will be lost.')) { setProject(null); setPosts([]); setActivePostId(null); } }} className="pcg-btn pcg-btn-secondary"><X size={14} /> End Project</button>
        </div>
      </div>

      {/* 3-column editor */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 270px', gap: 14, alignItems: 'start' }}>

        {/* ══ COL 1: Form ══ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {isEditing && (
            <div style={{ padding: '9px 12px', background: '#FEF3C7', borderRadius: 9, border: '1px solid #F59E0B', display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
              <Pencil size={12} color="#92400E" />
              <span style={{ color: '#92400E', fontWeight: 600, flex: 1 }}>Editing: {editForm.productName || 'product'}</span>
              <button onClick={cancelEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#92400E', fontWeight: 700 }}>✕</button>
            </div>
          )}

          <div className="pcg-card" style={{ padding: 16 }}>
            <div style={{ fontFamily: T.serif, fontSize: 15, fontWeight: 500, color: T.ink, marginBottom: 11 }}>{isEditing ? '✏️ Edit Product' : 'Add Product'}</div>

            {/* Image tabs */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 11, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
              {[{id:'url',label:'🔗 Link'},{id:'direct',label:'📋 URL'},{id:'screenshot',label:'📸 Photo'}].map((tab,i) => (
                <button key={tab.id} type="button" onClick={() => setEditForm(f => ({ ...f, imgMode: tab.id, imageUrl: '', manualImageUrl: '', screenshots: [], layout: 'single', activeScreenshot: 0 }))} style={{ flex:1, padding:'7px 3px', border:'none', cursor:'pointer', background:editForm.imgMode===tab.id?T.ink:T.surface, color:editForm.imgMode===tab.id?T.cream:T.muted, fontSize:11, fontWeight:editForm.imgMode===tab.id?600:400, borderRight:i<2?`1px solid ${T.border}`:'none', transition:'all 0.15s' }}>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Link mode */}
            {(!editForm.imgMode || editForm.imgMode === 'url') && (
              <div className="fade-in">
                <Field label="Product page link">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="pcg-input" value={editForm.productUrl} onChange={e => setEditForm(f => ({ ...f, productUrl: e.target.value }))} placeholder="https://shopee.com.my/..." style={{ flex:1 }} onKeyDown={e => e.key==='Enter' && fetchImage()} />
                    <button onClick={fetchImage} disabled={!editForm.productUrl||loading} className="pcg-btn pcg-btn-sm" style={{ flexShrink:0 }}>{loading?'⏳':'🔍'}</button>
                  </div>
                </Field>
                {loading && <div style={{ marginTop:5, fontSize:11, color:T.muted }}>⏳ Fetching…</div>}
                {fetchError && <div style={{ marginTop:6, padding:'7px 9px', background:'#FEF3C7', borderRadius:7, fontSize:11, color:'#92400E' }}>⚠️ {fetchError}<br/><span style={{fontSize:10}}>💡 Right-click product image → "Copy image address" → use 📋 URL tab</span></div>}
                {editForm.imageUrl && !fetchError && <div style={{ marginTop:5, padding:'6px 9px', background:'#D1FAE5', borderRadius:7, fontSize:11, color:'#065F46' }}>✅ Image fetched!</div>}
              </div>
            )}

            {/* Direct URL mode */}
            {editForm.imgMode === 'direct' && (
              <div className="fade-in">
                <Field label="Direct image URL"><input className="pcg-input" value={editForm.manualImageUrl} onChange={e => setEditForm(f => ({ ...f, manualImageUrl: e.target.value }))} placeholder="https://...product.jpg" /></Field>
                <div style={{ marginTop:5, fontSize:10.5, color:T.muted }}>Right-click product photo → "Copy image address" → paste here</div>
              </div>
            )}

            {/* Screenshot multi-photo mode */}
            {editForm.imgMode === 'screenshot' && (
              <div className="fade-in">
                <div style={{ marginBottom:9, padding:'7px 10px', background:T.cream, borderRadius:7, fontSize:11, color:T.muted, lineHeight:1.6, border:`1px solid ${T.borderSoft}` }}>
                  📸 Up to <strong>4 photos</strong>. Click a slot then <strong>Ctrl+V</strong> to paste, or tap "upload".
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:9 }}>
                  {[0,1,2,3].map(idx => {
                    const shot = editForm.screenshots?.[idx];
                    return (
                      <div key={idx} tabIndex={0}
                        onPaste={e => {
                          const items = e.clipboardData?.items;
                          if (!items) return;
                          for (const item of items) {
                            if (item.type.startsWith('image/')) {
                              const file = item.getAsFile();
                              const reader = new FileReader();
                              reader.onload = ev => setEditForm(f => { const shots=[...(f.screenshots||[])]; shots[idx]={id:uid(),src:ev.target.result}; const filled=shots.filter(Boolean).length; return {...f,screenshots:shots,layout:filled<=1?'single':filled===2?'duo':filled===3?'trio':'quad',activeScreenshot:f.activeScreenshot??0}; });
                              reader.readAsDataURL(file); e.preventDefault(); return;
                            }
                          }
                        }}
                        onClick={() => shot && setEditForm(f => ({ ...f, activeScreenshot: idx }))}
                        style={{ border:`2px dashed ${shot?T.terracotta:T.border}`, borderRadius:8, minHeight:78, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:shot?'#FFF8F5':T.cream, cursor:'pointer', outline:'none', position:'relative', overflow:'hidden', gap:3 }}
                      >
                        {shot ? (
                          <>
                            <img src={shot.src} alt="" style={{ width:'100%', height:74, objectFit:'cover', display:'block' }} />
                            {(editForm.activeScreenshot??0)===idx && <div style={{ position:'absolute',top:3,left:3,background:T.terracotta,color:'#fff',fontSize:8,fontWeight:700,padding:'2px 5px',borderRadius:3 }}>MAIN</div>}
                            <button type="button" onClick={e=>{e.stopPropagation();setEditForm(f=>{const shots=[...(f.screenshots||[])];shots[idx]=undefined;const filled=shots.filter(Boolean).length;return{...f,screenshots:shots,layout:filled<=1?'single':filled===2?'duo':filled===3?'trio':'quad',activeScreenshot:filled>0?shots.findIndex(Boolean):0};});}} style={{ position:'absolute',top:3,right:3,width:17,height:17,borderRadius:'50%',background:'rgba(0,0,0,0.5)',border:'none',color:'#fff',fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center' }}>×</button>
                            <div style={{ fontSize:9,color:T.muted,padding:'2px 0',background:'rgba(255,255,255,0.85)',width:'100%',textAlign:'center' }}>{(editForm.activeScreenshot??0)===idx?'★ Main':'tap→main'}</div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize:16,opacity:0.3 }}>📷</div>
                            <div style={{ fontSize:9.5,color:T.muted }}>Photo {idx+1}</div>
                            <label style={{ fontSize:9.5,color:T.terracotta,fontWeight:600,cursor:'pointer',textDecoration:'underline' }} onClick={e=>e.stopPropagation()}>
                              upload
                              <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>setEditForm(f=>{const shots=[...(f.screenshots||[])];shots[idx]={id:uid(),src:ev.target.result};const filled=shots.filter(Boolean).length;return{...f,screenshots:shots,layout:filled<=1?'single':filled===2?'duo':filled===3?'trio':'quad',activeScreenshot:f.activeScreenshot??0};});reader.readAsDataURL(file);}} />
                            </label>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                {(editForm.screenshots||[]).filter(Boolean).length > 1 && (
                  <div style={{ marginBottom:8 }}>
                    <div style={{ fontSize:10,fontWeight:500,color:T.muted,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:5 }}>Layout</div>
                    <div style={{ display:'flex', gap:4 }}>
                      {[{id:'single',label:'□ 1'},{id:'duo',label:'⊞ 2'},{id:'trio',label:'⊟ 1+2'},{id:'quad',label:'⊞ 4'}].map(l=>(
                        <button key={l.id} type="button" onClick={()=>setEditForm(f=>({...f,layout:l.id}))} style={{ flex:1,padding:'5px 2px',borderRadius:6,cursor:'pointer',background:editForm.layout===l.id?T.ink:T.surface,color:editForm.layout===l.id?T.cream:T.muted,border:`1px solid ${editForm.layout===l.id?T.ink:T.border}`,fontSize:10.5,fontWeight:editForm.layout===l.id?600:400,transition:'all 0.15s' }}>{l.label}</button>
                      ))}
                    </div>
                  </div>
                )}
                {(editForm.screenshots||[]).filter(Boolean).length > 0 && <div style={{ padding:'5px 8px',background:'#D1FAE5',borderRadius:6,fontSize:11,color:'#065F46' }}>✅ {(editForm.screenshots||[]).filter(Boolean).length} photo(s) · {editForm.layout}</div>}
              </div>
            )}

            <Field label="Product Name" style={{ marginTop:11 }}>
              <input className="pcg-input" value={editForm.productName} onChange={e=>setEditForm(f=>({...f,productName:e.target.value}))} placeholder="e.g. PUMA SOFTRIDE Flex Vital" />
            </Field>
            <Field label="Price (TAKA)" style={{ marginTop:9 }}>
              <input className="pcg-input" type="number" value={editForm.price} onChange={e=>setEditForm(f=>({...f,price:e.target.value}))} placeholder="6500" style={{ fontFamily:T.serif,fontSize:18,fontWeight:500 }} />
            </Field>
          </div>

          {/* Sale */}
          <div className="pcg-card" style={{ padding:16 }}>
            <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', marginBottom:editForm.onSale?11:0 }}>
              <input type="checkbox" checked={editForm.onSale} onChange={e=>setEditForm(f=>({...f,onSale:e.target.checked}))} style={{ width:15,height:15,accentColor:T.terracotta }} />
              <div><div style={{ fontWeight:500,fontSize:13,color:T.ink }}>🏷 Sale / Promo</div><div style={{ fontSize:11,color:T.muted }}>Adds sale badge + offer tag</div></div>
            </label>
            {editForm.onSale && (
              <div className="fade-in">
                <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,marginBottom:9 }}>
                  {SALE_OPTIONS.map(opt=>(
                    <button key={opt.id} type="button" onClick={()=>setEditForm(f=>({...f,saleType:opt.id,colors:{...f.colors,saleTagBg:opt.color}}))} style={{ padding:'7px 7px',borderRadius:7,cursor:'pointer',background:editForm.saleType===opt.id?opt.color:T.surface,color:editForm.saleType===opt.id?'#fff':T.ink,border:`1px solid ${editForm.saleType===opt.id?opt.color:T.border}`,fontSize:11.5,fontWeight:500,display:'flex',alignItems:'center',gap:4,transition:'all 0.15s' }}>{opt.icon} {opt.label}</button>
                  ))}
                </div>
                {editForm.saleType==='other' && <Field label="Custom Label" style={{marginBottom:9}}><input className="pcg-input" value={editForm.customSaleLabel} onChange={e=>setEditForm(f=>({...f,customSaleLabel:e.target.value}))} placeholder="e.g. Eid Special" /></Field>}
                <Field label="Offer Ends"><input className="pcg-input" type="datetime-local" value={editForm.offerEnds} onChange={e=>setEditForm(f=>({...f,offerEnds:e.target.value}))} /></Field>
              </div>
            )}
          </div>

          {/* CTA */}
          {isEditing ? (
            <div style={{ display:'flex', gap:7 }}>
              <button onClick={saveEdit} className="pcg-btn" style={{ flex:1,justifyContent:'center',padding:'10px' }}><Save size={13}/> Save Changes</button>
              <button onClick={cancelEdit} className="pcg-btn pcg-btn-secondary" style={{ padding:'10px 12px' }}><X size={13}/></button>
            </div>
          ) : (
            <button onClick={addPostToProject} className="pcg-btn" style={{ width:'100%',justifyContent:'center',padding:'11px',fontSize:14 }}>+ Add to Project</button>
          )}
        </div>

        {/* ══ COL 2: Preview + Gallery ══ */}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {/* Live preview label */}
          <div style={{ fontSize:11,fontWeight:500,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em' }}>
            {isEditing ? '✏️ Editing Preview' : 'Live Preview'}
          </div>
          <div style={{ display:'flex', justifyContent:'center' }}>
            {(() => {
              const colors = editForm.colors;
              const isDark = ['#0F0F0F','#0F172A','#1C1C1C','#111111'].includes(colors.bgColor);
              const shots = (editForm.screenshots||[]).filter(Boolean);
              const layout = editForm.layout||'single';
              const imgS = { objectFit:'cover', display:'block' };
              return (
                <div data-postcard="1" style={{ width:420,fontFamily:T.serif,background:colors.bgColor==='transparent'?'#fff':colors.bgColor,overflow:'hidden',position:'relative',border:isDark?'none':'1px solid #E0E0E0',boxShadow:'0 10px 40px rgba(0,0,0,0.15)' }}>
                  <div style={{ background:colors.brandBarBg,padding:'9px 18px',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                    <div style={{ color:colors.brandBarTextColor,fontSize:10,fontWeight:700,letterSpacing:'0.18em',textTransform:'uppercase' }}>@{(company.displayName||'').toLowerCase().replace(/\s+/g,'')}</div>
                    <div style={{ color:colors.brandBarTextColor,fontSize:10,opacity:0.85 }}>{company.contact}</div>
                  </div>
                  <div style={{ padding:'13px 18px 10px',textAlign:'center',background:colors.productNameBg==='transparent'?'transparent':colors.productNameBg,borderBottom:`1px solid ${colors.bottomDividerColor}` }}>
                    <div style={{ fontSize:15,fontWeight:700,color:colors.productNameColor,letterSpacing:'0.02em',textTransform:'uppercase' }}>{editForm.productName||'PRODUCT NAME'}</div>
                  </div>
                  {editForm.onSale&&(editForm.saleType||editForm.customSaleLabel)&&(
                    <div
                      title="Drag to reposition sale tag anywhere on the card"
                      onMouseDown={e => {
                        e.preventDefault();
                        const card = e.currentTarget.closest('[data-postcard]');
                        if (!card) return;
                        const onMove = mv => {
                          const rect = card.getBoundingClientRect();
                          const newX = Math.max(0, Math.min(360, mv.clientX - rect.left - 40));
                          const newY = Math.max(36, Math.min(560, mv.clientY - rect.top - 12));
                          setC('saleTagX')(Math.round(newX));
                          setC('saleTagY')(Math.round(newY));
                        };
                        const onUp = () => {
                          document.removeEventListener('mousemove', onMove);
                          document.removeEventListener('mouseup', onUp);
                        };
                        document.addEventListener('mousemove', onMove);
                        document.addEventListener('mouseup', onUp);
                      }}
                      style={{ position:'absolute', top:editForm.colors.saleTagY||78, left:editForm.colors.saleTagX||0, zIndex:20, background:colors.saleTagBg, color:colors.saleTagColor, padding:'5px 14px 5px 10px', fontSize:11, fontWeight:800, borderRadius:(editForm.colors.saleTagX||0)<10?'0 6px 6px 0':6, letterSpacing:'0.05em', textTransform:'uppercase', display:'flex', alignItems:'center', gap:4, cursor:'grab', userSelect:'none', boxShadow:'0 2px 8px rgba(0,0,0,0.18)' }}>
                      {sale?.icon||'🏷'} {editForm.saleType==='other'?(editForm.customSaleLabel||'Special'):(sale?.label||'')} <span style={{fontSize:8,opacity:0.6}}>⠿</span>
                    </div>
                  )}
                  <div style={{ background:colors.bgColor==='transparent'?'#fff':colors.bgColor,position:'relative' }}>
                    {editForm.imgMode==='screenshot'&&shots.length>1 ? (
                      layout==='duo'&&shots.length>=2?(
                        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:3 }}>{shots.slice(0,2).map((s,i)=><img key={i} src={s.src} alt="" style={{...imgS,width:'100%',height:220}} />)}</div>
                      ):layout==='trio'&&shots.length>=3?(
                        <div><img src={shots[0].src} alt="" style={{...imgS,width:'100%',height:155}}/><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:3,marginTop:3}}>{shots.slice(1,3).map((s,i)=><img key={i} src={s.src} alt="" style={{...imgS,width:'100%',height:108}}/>)}</div></div>
                      ):layout==='quad'&&shots.length>=4?(
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:3}}>{shots.slice(0,4).map((s,i)=><img key={i} src={s.src} alt="" style={{...imgS,width:'100%',height:130}}/>)}</div>
                      ):(
                        <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'28px 24px 16px'}}><img src={shots[editForm.activeScreenshot||0]?.src||shots[0].src} alt="" style={{maxWidth:'88%',maxHeight:250,objectFit:'contain',filter:'drop-shadow(0 12px 28px rgba(0,0,0,0.22))'}}/></div>
                      )
                    ):activeImage?(
                      <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'28px 24px 16px',minHeight:260}}>
                        <img src={activeImage} alt="product" style={{maxWidth:'88%',maxHeight:250,objectFit:'contain',filter:'drop-shadow(0 12px 28px rgba(0,0,0,0.22))'}}/>
                      </div>
                    ):(
                      <div style={{minHeight:260,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:8,color:'#BBB'}}><span style={{fontSize:36}}>👟</span><span style={{fontSize:12}}>Add photos</span></div>
                    )}
                  </div>
                  <div style={{ padding:'6px 18px 4px',textAlign:'center',background:colors.priceBg==='transparent'?'transparent':colors.priceBg }}>
                    <div style={{ fontSize:27,fontWeight:900,letterSpacing:'0.04em',color:colors.priceColor,textTransform:'uppercase',...(colors.priceBorderColor&&colors.priceBorderColor!=='transparent'?{display:'inline-block',border:`2px solid ${colors.priceBorderColor}`,borderRadius:10,padding:'4px 18px'}:{}) }}>
                      PRICE - {fmtPriceDisplay(editForm.price)||'0'} TAKA
                    </div>
                  </div>
                  <div style={{ textAlign:'center',padding:'3px 18px 10px' }}>
                    {editForm.onSale&&editForm.offerEnds?<div style={{fontSize:10,color:colors.limitedOfferColor,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase'}}>OFFER ENDS {fmtOfferEnds(editForm.offerEnds)}</div>:editForm.onSale?<div style={{fontSize:10,color:colors.limitedOfferColor,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase'}}>LIMITED TIME OFFER</div>:null}
                  </div>
                  <div style={{ padding:'10px 18px 13px',display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:`1px solid ${colors.bottomDividerColor}` }}>
                    <div style={{fontSize:9,color:colors.brandNameColor,opacity:0.6}}>@{(company.displayName||'').toLowerCase().replace(/\s+/g,'')}</div>
                    <div style={{fontSize:23,fontWeight:700,color:colors.brandNameColor,letterSpacing:'0.08em',fontStyle:'italic',flex:1,textAlign:'center'}}>{company.displayName}</div>
                    <div style={{fontSize:9,color:colors.brandNameColor,opacity:0.6,textAlign:'right'}}>{company.contact}</div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Gallery */}
          {posts.length > 0 && (
            <div>
              <div style={{ fontSize:11,fontWeight:500,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:9,display:'flex',alignItems:'center',justifyContent:'space-between' }}>
                <span>Project ({posts.length})</span>
                <div style={{ display:'flex', gap:5 }}>
                  <button onClick={downloadAll} className="pcg-btn pcg-btn-sm" style={{ background:T.success }}><Download size={11}/> All PNG</button>
                </div>
              </div>

              {/* Facebook & Instagram share strip */}
              <div style={{ marginBottom:10, padding:'10px 14px', background:'#F0F4FF', borderRadius:10, border:'1px solid #C7D2FE' }}>
                <div style={{ fontSize:11, fontWeight:600, color:'#3730A3', marginBottom:8, display:'flex', alignItems:'center', gap:5 }}>
                  📤 Share to Social Media
                  <span style={{ fontSize:10, fontWeight:400, color:'#6B7280', marginLeft:4 }}>(opens pre-filled, you just tap Post)</span>
                </div>
                <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
                  <button
                    onClick={() => { window.open('https://www.facebook.com/sharer/sharer.php?u=https://drip-ittt.com&quote=' + encodeURIComponent(posts.map(p=>`${p.productName} — PRICE ${fmtPriceDisplay(p.price)} TAKA${p.onSale?' (SALE)':''}`).join('\n')), '_blank', 'width=600,height=500'); }}
                    className="pcg-btn pcg-btn-sm"
                    style={{ background:'#1877F2', gap:5, padding:'7px 12px' }}
                  >
                    <span style={{fontSize:13}}>f</span> Share to Facebook
                  </button>
                  <button
                    onClick={() => { window.open('https://www.instagram.com/', '_blank'); showToast('Instagram opened — paste caption & upload PNG images there'); }}
                    className="pcg-btn pcg-btn-sm"
                    style={{ background:'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', gap:5, padding:'7px 12px', border:'none' }}
                  >
                    <span style={{fontSize:13}}>📸</span> Open Instagram
                  </button>
                  <button
                    onClick={() => {
                      const text = posts.map(p => `${p.productName}\nPRICE - ${fmtPriceDisplay(p.price)} TAKA${p.onSale ? '\n🏷 ON SALE — LIMITED TIME OFFER' : ''}`).join('\n\n');
                      navigator.clipboard.writeText(text).then(() => showToast('All captions copied! Paste on Facebook/Instagram'));
                    }}
                    className="pcg-btn pcg-btn-sm pcg-btn-secondary"
                    style={{ gap:5, padding:'7px 12px' }}
                  >
                    <Copy size={11}/> Copy All Captions
                  </button>
                </div>
                <div style={{ fontSize:10, color:'#6B7280', marginTop:7, lineHeight:1.6 }}>
                  💡 <strong>Workflow:</strong> Download PNGs → Click Share → Upload images manually → Caption is pre-copied. Instagram requires manual upload (no direct API without a business account).
                </div>
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
                {posts.map(post => (
                  <div key={post.id} style={{ background:T.surface, border:`1px solid ${editForm._editingId===post.id?T.terracotta:T.borderSoft}`, borderRadius:10, padding:'9px 13px', display:'flex', alignItems:'center', gap:11 }}>
                    <div style={{ width:46,height:46,borderRadius:7,background:post.colors.bgColor==='transparent'?'#F8F8F8':post.colors.bgColor,overflow:'hidden',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',border:`1px solid ${T.borderSoft}` }}>
                      {post.imageUrl?<img src={post.imageUrl} alt="" style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}}/>:((post.screenshots||[]).filter(Boolean)[0]?.src?<img src={(post.screenshots||[]).filter(Boolean)[0].src} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<span style={{fontSize:18}}>👟</span>)}
                    </div>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ fontWeight:500,fontSize:13,color:T.ink,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{post.productName||'Unnamed'}</div>
                      <div style={{ fontSize:11.5,color:T.muted,marginTop:2,display:'flex',alignItems:'center',gap:5 }}>
                        {fmtPriceDisplay(post.price)} TK
                        {post.onSale&&<span style={{padding:'1px 6px',background:post.colors.saleTagBg,color:post.colors.saleTagColor,borderRadius:3,fontSize:9,fontWeight:700}}>SALE</span>}
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:4, flexShrink:0 }}>
                      {/* individual FB share */}
                      <button onClick={() => { window.open(`https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(`${post.productName}\nPRICE - ${fmtPriceDisplay(post.price)} TAKA${post.onSale?' — SALE':''}`)}`, '_blank','width=600,height=500'); }} className="pcg-btn pcg-btn-sm" style={{background:'#1877F2',padding:'5px 7px'}} title="Share this on Facebook">
                        <span style={{fontSize:11,fontWeight:700}}>f</span>
                      </button>
                      <button onClick={()=>editPost(post)} className="pcg-btn pcg-btn-sm pcg-btn-secondary" title="Edit design" style={{padding:'5px 8px'}}><Pencil size={11}/></button>
                      <button onClick={()=>downloadPost(post)} disabled={post.downloading} className="pcg-btn pcg-btn-sm" style={{background:post.downloaded?T.success:T.ink,minWidth:58,justifyContent:'center'}} title="Download PNG">
                        {post.downloading?'⏳':post.downloaded?<><Check size={11}/> ✓</>:<><Download size={11}/> PNG</>}
                      </button>
                      <button onClick={()=>removePost(post.id)} className="pcg-btn pcg-btn-ghost pcg-btn-sm" title="Remove" style={{padding:'5px 6px'}}><Trash2 size={11}/></button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:9,padding:'7px 11px',background:T.cream,borderRadius:8,fontSize:11,color:T.muted,border:`1px solid ${T.borderSoft}` }}>
                ✏️ Edit · 📥 PNG (html2canvas 3×) · 🏷 Drag sale tag in preview to reposition
              </div>
            </div>
          )}
        </div>

        {/* ══ COL 3: Color Studio (sticky) ══ */}
        <div style={{ position:'sticky', top:20 }}>
          <div className="pcg-card" style={{ padding:13, maxHeight:'calc(100vh - 120px)', overflowY:'auto' }}>
            <div style={{ fontFamily:T.serif,fontSize:14,fontWeight:500,color:T.ink,marginBottom:10 }}>🎨 Color Studio</div>
            {[
              {section:'Background'},
              {key:'bgColor',label:'Card Bg',presets:BG_PRESETS},
              {key:'bottomDividerColor',label:'Lines',presets:['#EBEBEB','#DDDDDD','#CCC','#444','transparent']},
              {section:'Product Name'},
              {key:'productNameColor',label:'Text',presets:TEXT_PRESETS},
              {key:'productNameBg',label:'Row Bg',presets:BG_PRESETS},
              {section:'Price'},
              {key:'priceColor',label:'Color',presets:PRICE_PRESETS},
              {key:'priceBorderColor',label:'Border',presets:['transparent',...PRICE_PRESETS]},
              {key:'priceBg',label:'Bg',presets:BG_PRESETS},
              {section:'Offer Text'},
              {key:'limitedOfferColor',label:'Color',presets:['#CC0000','#E11D48','#D97706','#2D6A4F','#3A6FA1','#111','#FFF']},
              {section:'Sale Tag'},
              {key:'saleTagBg',label:'Tag Bg',presets:TAG_PRESETS},
              {key:'saleTagColor',label:'Tag Text',presets:['#FFFFFF','#111111','#FFD700']},
              {section:'Brand Bar'},
              {key:'brandBarBg',label:'Bar Bg',presets:['#B5482E','#E11D48','#3A6FA1','#0F0F0F','#4F46E5','#D97706','#FFFFFF']},
              {key:'brandBarTextColor',label:'Bar Text',presets:['#FFFFFF','#111111','#FFD700']},
              {section:'Brand Name'},
              {key:'brandNameColor',label:'Color',presets:TEXT_PRESETS},
            ].map((item,i) => {
              if(item.section) return (
                <div key={i} style={{display:'flex',alignItems:'center',gap:5,marginTop:i===0?0:8,marginBottom:2}}>
                  <div style={{height:1,flex:1,background:T.borderSoft}}/>
                  <div style={{fontSize:9,fontWeight:600,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em',whiteSpace:'nowrap'}}>{item.section}</div>
                  <div style={{height:1,flex:1,background:T.borderSoft}}/>
                </div>
              );
              return <ColorRow key={item.key} label={item.label} value={editForm.colors[item.key]} onChange={setC(item.key)} presets={item.presets} />;
            })}

            {/* Sale tag position sliders */}
            {editForm.onSale && (
              <div style={{ marginTop:8 }}>
                <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:5}}>
                  <div style={{height:1,flex:1,background:T.borderSoft}}/>
                  <div style={{fontSize:9,fontWeight:600,color:T.muted,textTransform:'uppercase',letterSpacing:'0.08em'}}>Tag Position</div>
                  <div style={{height:1,flex:1,background:T.borderSoft}}/>
                </div>
                <div style={{ fontSize:10, color:T.muted, marginBottom:5 }}>Drag tag in preview, or use sliders:</div>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                  <span style={{fontSize:10,color:T.muted,minWidth:16}}>X</span>
                  <input type="range" min={0} max={360} value={editForm.colors.saleTagX||0} onChange={e=>setC('saleTagX')(parseInt(e.target.value))} style={{flex:1,accentColor:T.terracotta,height:4}} />
                  <span style={{fontSize:10,color:T.muted,minWidth:24,textAlign:'right'}}>{editForm.colors.saleTagX||0}</span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{fontSize:10,color:T.muted,minWidth:16}}>Y</span>
                  <input type="range" min={36} max={580} value={editForm.colors.saleTagY||78} onChange={e=>setC('saleTagY')(parseInt(e.target.value))} style={{flex:1,accentColor:T.terracotta,height:4}} />
                  <span style={{fontSize:10,color:T.muted,minWidth:24,textAlign:'right'}}>{editForm.colors.saleTagY||78}</span>
                </div>
              </div>
            )}

            <button onClick={()=>setEditForm(f=>({...f,colors:{...DEFAULT_COLORS}}))} className="pcg-btn pcg-btn-secondary" style={{marginTop:10,width:'100%',justifyContent:'center',fontSize:11}}>↺ Reset colors</button>
          </div>
        </div>

      </div>
    </div>
  );
}



function ExportView({ orders, expenses, ledger, loans, invoices, showToast, company }) {
  const SYNC_URL_KEY = 'po_sheets_url';
  const [sheetsUrl, setSheetsUrl] = useState(() => {
    try { return localStorage.getItem(SYNC_URL_KEY) || ''; } catch { return ''; }
  });
  const [urlInput, setUrlInput] = useState(sheetsUrl);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState({}); // { orders: 'ok'|'error'|'syncing', ... }
  const [lastSynced, setLastSynced] = useState(null);
  const [showScript, setShowScript] = useState(false);

  const saveUrl = () => {
    const url = urlInput.trim();
    try { localStorage.setItem(SYNC_URL_KEY, url); } catch {}
    setSheetsUrl(url);
    // Also write into the storage constant so live saves work
    // We do this by monkey-patching API_URL via the module-level ref trick
    window.__PO_SHEETS_URL__ = url;
    showToast(url ? 'Google Sheets URL saved! Data will sync in real time.' : 'Sync disabled.');
  };

  // Effective URL — uses saved local pref OR the hardcoded API_URL constant
  const effectiveUrl = sheetsUrl || (typeof API_URL !== 'undefined' ? API_URL : '');

  const syncOne = async (entity, data) => {
    setSyncStatus(s => ({ ...s, [entity]: 'syncing' }));
    try {
      const url = effectiveUrl;
      if (!url) throw new Error('No URL');
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'replaceAll', entity, data })
      });
      setSyncStatus(s => ({ ...s, [entity]: 'ok' }));
      return true;
    } catch (e) {
      setSyncStatus(s => ({ ...s, [entity]: 'error' }));
      return false;
    }
  };

  const syncAll = async () => {
    if (!effectiveUrl) { showToast('Paste your Google Sheets Web App URL first', 'error'); return; }
    setSyncing(true);
    setSyncStatus({});
    const results = await Promise.all([
      syncOne('orders', orders),
      syncOne('expenses', expenses),
      syncOne('ledger', ledger),
      syncOne('loans', loans),
      syncOne('invoices', invoices),
    ]);
    setSyncing(false);
    const allOk = results.every(Boolean);
    setLastSynced(new Date());
    showToast(allOk ? '✅ All data synced to Google Sheets!' : '⚠️ Some tables failed — check your Apps Script URL', allOk ? 'success' : 'error');
  };

  const downloadCSV = (type) => {
    let csv = '', filename = '';
    if (type === 'orders') {
      csv = 'Order Number,Customer Name,Phone,Facebook,Product,Description,Cost (RM),Selling Price (BDT),Advance Required (BDT),Advance via bKash (BDT),Due (BDT),Status,Advance Paid,Order Placed MY,Reached BD,Out for Delivery,Delivered,Order Date,Notes\n';
      orders.forEach(o => {
        const c = calcOrder(o);
        const row = [o.orderNumber, o.customerName, o.customerPhone, o.customerFb, o.productName, o.productDescription, c.cost, c.selling, c.advance, c.advanceBkash, c.due, STATUS[o.status]?.label, o.advancePaid, o.orderPlacedMY, o.reachedBD, o.onTheWay, o.delivered, fmtDate(o.orderDate), (o.notes || '').replace(/\n/g, ' ')].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
        csv += row + '\n';
      });
      filename = `${company.id}_orders_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (type === 'expenses') {
      csv = 'Date,Description,Category,Amount,Currency\n';
      expenses.forEach(e => csv += [fmtDate(e.date), e.description, e.category, e.amount, e.currency].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',') + '\n');
      filename = `${company.id}_expenses_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (type === 'ledger') {
      csv = 'Date,Direction,Type,Account,Party,Amount,Currency,Description\n';
      ledger.forEach(l => csv += [fmtDate(l.date), l.direction, l.type, l.account, l.party || '', l.amount, l.currency, l.description || ''].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',') + '\n');
      filename = `${company.id}_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (type === 'loans') {
      csv = 'Type,Party,Principal,Currency,Amount Repaid,Status,Date,Due Date,Notes\n';
      loans.forEach(l => csv += [l.type, l.party, l.principal, l.currency, l.amountRepaid || 0, l.status, fmtDate(l.date), fmtDate(l.dueDate), l.notes || ''].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',') + '\n');
      filename = `${company.id}_loans_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (type === 'invoices') {
      csv = 'Invoice Number,Date,Customer,Phone,Items Count,Subtotal,Discount,Total\n';
      invoices.forEach(i => csv += [i.invoiceNumber, fmtDate(i.date), i.customer?.name, i.customer?.phone, i.items.length, i.subtotal, i.discount, i.total].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',') + '\n');
      filename = `${company.id}_invoices_${new Date().toISOString().slice(0, 10)}.csv`;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    showToast(`${filename} downloaded`);
  };

  const tables = [
    { entity: 'orders',   label: 'Orders',       count: orders.length,   icon: ShoppingBag, color: T.terracotta },
    { entity: 'invoices', label: 'Invoices',      count: invoices.length, icon: FileText,     color: '#3A6FA1' },
    { entity: 'expenses', label: 'Expenses',      count: expenses.length, icon: Receipt,      color: T.olive },
    { entity: 'ledger',   label: 'Transactions',  count: ledger.length,   icon: ArrowLeftRight, color: '#6B4FA8' },
    { entity: 'loans',    label: 'Loans',         count: loans.length,    icon: Banknote,     color: T.warning },
  ];

  const appsScriptCode = `// ═══════════════════════════════════════════════
// PreOrder Console — Google Apps Script Backend
// Paste this into script.google.com → New Project
// Then: Deploy → New Deployment → Web App
//       Execute as: Me | Who can access: Anyone
// Copy the Web App URL → paste into the app
// ═══════════════════════════════════════════════

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

const HEADERS = {
  orders:   ['id','orderNumber','customerName','customerPhone','customerFb','productName','productDescription','costPriceRM','conversionRate','multiplier','status','orderDate','advancePaid','deliveryDate','notes'],
  expenses: ['id','date','description','category','amount','currency'],
  ledger:   ['id','date','direction','type','account','party','amount','currency','description','kind','relatedOrderId'],
  loans:    ['id','type','party','principal','currency','amountRepaid','status','date','dueDate','notes'],
  invoices: ['id','invoiceNumber','date','subtotal','discount','total'],
  accounts: ['id','name','type','currency','openingBalance'],
  counters: ['id','orderSeq','invoiceSeq','receiptSeq'],
};

function getSheet(entity) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(entity);
  if (!sheet) {
    sheet = ss.insertSheet(entity);
    if (HEADERS[entity]) sheet.appendRow(HEADERS[entity]);
  }
  return sheet;
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { action, entity, data } = payload;
    if (!HEADERS[entity]) return respond({ ok: false, error: 'Unknown entity: ' + entity });

    if (action === 'replaceAll') {
      const sheet = getSheet(entity);
      const headers = HEADERS[entity];
      // Clear data rows only (keep header)
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
      // Write new rows
      if (data && data.length > 0) {
        const rows = data.map(item => headers.map(h => {
          const v = item[h];
          return v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v);
        }));
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      }
      return respond({ ok: true, written: (data || []).length });
    }

    if (action === 'save') {
      // Upsert single row by id
      const sheet = getSheet(entity);
      const headers = HEADERS[entity];
      const idCol = 1; // 'id' is always first
      const allData = sheet.getDataRange().getValues();
      const rowIdx = allData.slice(1).findIndex(r => String(r[0]) === String(data.id));
      const newRow = headers.map(h => { const v = data[h]; return v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v); });
      if (rowIdx >= 0) {
        sheet.getRange(rowIdx + 2, 1, 1, newRow.length).setValues([newRow]);
      } else {
        sheet.appendRow(newRow);
      }
      return respond({ ok: true });
    }

    return respond({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return respond({ ok: false, error: err.toString() });
  }
}

function doGet(e) {
  try {
    const { action, entity } = e.parameter;
    if (action === 'list' && HEADERS[entity]) {
      const sheet = getSheet(entity);
      const values = sheet.getDataRange().getValues();
      if (values.length <= 1) return respond({ ok: true, data: [] });
      const headers = values[0];
      const data = values.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] === '' ? null : row[i]; });
        return obj;
      });
      return respond({ ok: true, data });
    }
    return respond({ ok: false, error: 'Unknown request' });
  } catch (err) {
    return respond({ ok: false, error: err.toString() });
  }
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}`;

  const StatusDot = ({ entity }) => {
    const s = syncStatus[entity];
    if (!s) return null;
    const colors = { ok: '#16a34a', error: '#dc2626', syncing: '#d97706' };
    const labels = { ok: '✓', error: '✗', syncing: '…' };
    return <span style={{ marginLeft: 6, fontSize: 11, color: colors[s], fontWeight: 700 }}>{labels[s]}</span>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ── Real-time Sync Card ── */}
      <div className="pcg-card" style={{ background: T.ink, color: T.cream, border: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <FileSpreadsheet size={20} color={T.cream} />
          <div>
            <h3 style={{ fontFamily: T.serif, fontSize: 18, margin: 0, fontWeight: 500 }}>Real-time Google Sheets Sync</h3>
            <div style={{ fontSize: 12, color: T.cream + '99', marginTop: 2 }}>
              {sheetsUrl ? '🟢 Connected — data syncs on every save' : '⚪ Not connected — paste your Web App URL below'}
            </div>
          </div>
        </div>

        {/* URL input */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            placeholder="https://script.google.com/macros/s/AKfy.../exec"
            style={{ flex: 1, padding: '9px 14px', borderRadius: 8, border: `1px solid ${T.cream}33`, background: 'rgba(255,255,255,0.1)', color: T.cream, fontSize: 13, outline: 'none' }}
          />
          <button onClick={saveUrl} className="pcg-btn" style={{ background: '#16a34a', flexShrink: 0, gap: 6 }}>
            <Save size={13} /> Save URL
          </button>
        </div>

        {/* Sync all button */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={syncAll} disabled={syncing || !effectiveUrl} className="pcg-btn" style={{ background: syncing ? '#555' : '#1877F2', gap: 6 }}>
            <ArrowLeftRight size={13} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
            {syncing ? 'Syncing…' : 'Sync All to Google Sheets Now'}
          </button>
          {lastSynced && <span style={{ fontSize: 11.5, color: T.cream + '99' }}>Last synced: {lastSynced.toLocaleTimeString()}</span>}
        </div>

        {/* Per-table status row */}
        {Object.keys(syncStatus).length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            {tables.map(t => {
              const s = syncStatus[t.entity];
              if (!s) return null;
              const bg = s === 'ok' ? '#16a34a22' : s === 'error' ? '#dc262622' : '#d9770622';
              const col = s === 'ok' ? '#16a34a' : s === 'error' ? '#dc2626' : '#d97706';
              return (
                <div key={t.entity} style={{ padding: '4px 10px', borderRadius: 6, background: bg, color: col, fontSize: 12, fontWeight: 600 }}>
                  {t.label} {s === 'ok' ? '✓' : s === 'error' ? '✗' : '…'}
                </div>
              );
            })}
          </div>
        )}

        {/* How to set up */}
        <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(255,255,255,0.07)', borderRadius: 10, fontSize: 12, color: T.cream + 'CC', lineHeight: 1.8 }}>
          <strong style={{ color: T.cream }}>How to connect (one-time setup, 3 minutes):</strong>
          <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            <li>Open <a href="https://script.google.com" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>script.google.com</a> → <strong>New Project</strong></li>
            <li>Delete all code → paste the Apps Script below → <strong>Save</strong></li>
            <li><strong>Deploy → New Deployment → Web App</strong><br/>Execute as: <em>Me</em> · Who can access: <em>Anyone</em></li>
            <li>Copy the <strong>Web App URL</strong> → paste above → Save URL</li>
            <li>Click <strong>Sync All</strong> — your data appears in Google Sheets instantly</li>
            <li>From now on every order, expense, and transaction syncs automatically ✅</li>
          </ol>
        </div>

        {/* Apps Script toggle */}
        <button onClick={() => setShowScript(s => !s)} className="pcg-btn pcg-btn-secondary" style={{ marginTop: 12, background: 'rgba(255,255,255,0.1)', color: T.cream, border: `1px solid ${T.cream}33` }}>
          {showScript ? '▲ Hide' : '▼ Show'} Apps Script Code (copy & paste into script.google.com)
        </button>

        {showScript && (
          <div style={{ marginTop: 10, position: 'relative' }}>
            <button
              onClick={() => { navigator.clipboard.writeText(appsScriptCode); showToast('Apps Script code copied!'); }}
              className="pcg-btn pcg-btn-sm"
              style={{ position: 'absolute', top: 8, right: 8, background: '#16a34a', zIndex: 1 }}
            >
              <Copy size={12} /> Copy Code
            </button>
            <pre style={{
              background: '#0d1117', color: '#e6edf3', borderRadius: 10, padding: '14px 16px',
              fontSize: 11.5, lineHeight: 1.6, overflowX: 'auto', margin: 0,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace", maxHeight: 400, overflowY: 'auto'
            }}>
              {appsScriptCode}
            </pre>
          </div>
        )}
      </div>

      {/* ── CSV Downloads ── */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Manual CSV Export</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {tables.map(({ entity, label, count, icon: Icon, color }) => (
            <div key={entity} className="pcg-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={15} color={color} strokeWidth={1.75} /></div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: T.ink }}>{label} <StatusDot entity={entity} /></div>
                  <div style={{ fontSize: 11, color: T.muted }}>{count} records</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => downloadCSV(entity === 'ledger' ? 'ledger' : entity)} className="pcg-btn pcg-btn-secondary pcg-btn-sm" disabled={!count} style={{ flex: 1, justifyContent: 'center' }}>
                  <Download size={11} /> CSV
                </button>
                <button onClick={() => syncOne(entity, entity === 'orders' ? orders : entity === 'expenses' ? expenses : entity === 'ledger' ? ledger : entity === 'loans' ? loans : invoices)} className="pcg-btn pcg-btn-sm" disabled={!effectiveUrl || !count} style={{ flex: 1, justifyContent: 'center', background: '#1877F2' }}>
                  <ArrowLeftRight size={11} /> Sync
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SHARED EDIT MODAL & UTILITIES
// ═══════════════════════════════════════════════════════════════════
function EditModal({ title, onClose, onSave, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, backdropFilter: 'blur(6px)' }}>
      <div onClick={e => e.stopPropagation()} className="fade-in" style={{ background: T.cream, borderRadius: 14, width: '90%', maxWidth: 560, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 24px', borderBottom: `1.5px solid ${T.border}`, background: T.cream, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: 18, margin: 0, fontWeight: 800, color: T.ink }}>{title}</h3>
          <button onClick={onClose} className="pcg-btn pcg-btn-ghost"><X size={20} /></button>
        </div>
        <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>{children}</div>
        <div style={{ padding: '16px 24px', borderTop: `1.5px solid ${T.border}`, background: T.cream, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="pcg-btn pcg-btn-secondary">Cancel</button>
          <button onClick={onSave} className="pcg-btn"><Save size={14} /> Save Changes</button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div style={{ textAlign: 'center', padding: '28px 16px', color: T.muted }}>
      <div style={{ width: 42, height: 42, borderRadius: '50%', background: T.cream, margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Package size={18} color={T.muted} strokeWidth={1.5} />
      </div>
      <div style={{ fontSize: 13 }}>{text}</div>
    </div>
  );
}

function Toast({ toast }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: toast.type === 'error' ? T.terracotta : T.ink, color: T.cream,
      padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 500, zIndex: 1000,
      boxShadow: '0 10px 40px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: 8
    }}>
      {toast.type === 'error' ? <AlertCircle size={16} /> : <Check size={16} />}
      {toast.msg}
    </div>
  );
}