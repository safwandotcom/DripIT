// One-time migration: seed Redis from a JSON export of the production
// browser's localStorage (same shape as the exports used for the earlier
// local-dev -> production data merge). Run manually:
//
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
//     node scripts/migrate.mjs path/to/export.json [--env=preview|prod]
//
// The export JSON is expected to have the shape:
//   { po_orders: [...], po_expenses: [...], po_ledger: [...],
//     po_loans: [...], po_accounts: [...], po_invoices: [...],
//     po_counters: { drip_ittt: { order, invoice }, NOVUS: { order, invoice } },
//     po_settings: { realExchangeRate } }
import { readFileSync } from 'node:fs';
import { Redis } from '@upstash/redis';

const [, , exportPath, envFlag] = process.argv;
if (!exportPath) {
  console.error('Usage: node scripts/migrate.mjs <export.json> [--env=preview|prod]');
  process.exit(1);
}
const prefix = envFlag === '--env=prod' ? 'prod' : 'preview';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const exportData = JSON.parse(readFileSync(exportPath, 'utf-8'));

const ENTITY_MAP = {
  orders: 'po_orders', expenses: 'po_expenses', ledger: 'po_ledger',
  loans: 'po_loans', accounts: 'po_accounts', invoices: 'po_invoices',
};

async function main() {
  for (const [entity, sourceKey] of Object.entries(ENTITY_MAP)) {
    const value = exportData[sourceKey] || [];
    await redis.set(`${prefix}:data:${entity}`, value);
    console.log(`Seeded ${prefix}:data:${entity} — ${value.length} item(s)`);
  }

  const settings = exportData.po_settings || { realExchangeRate: 32 };
  await redis.set(`${prefix}:data:settings`, settings);
  console.log(`Seeded ${prefix}:data:settings —`, settings);

  // Initialize the atomic counters one past the highest number already in
  // use, so numbering continues rather than restarting at 1 and colliding
  // with existing orders/invoices.
  const counters = exportData.po_counters || {};
  const companies = new Set(Object.keys(counters));
  (exportData.po_orders || []).forEach(o => o.company && companies.add(o.company));

  for (const company of companies) {
    for (const type of ['order', 'invoice']) {
      const fromCounters = (counters[company] || {})[type] || 1;
      const prefixLetters = company === 'NOVUS'
        ? (type === 'order' ? 'NV-' : 'NV-INV-')
        : (type === 'order' ? 'DI-' : 'DI-INV-');
      const items = type === 'order' ? (exportData.po_orders || []) : (exportData.po_invoices || []);
      const numberField = type === 'order' ? 'orderNumber' : 'invoiceNumber';
      let maxFromData = 0;
      items.forEach(it => {
        const num = it[numberField];
        if (num && num.startsWith(prefixLetters)) {
          const n = parseInt(num.slice(prefixLetters.length), 10);
          if (!isNaN(n) && n > maxFromData) maxFromData = n;
        }
      });
      const startAt = Math.max(maxFromData, fromCounters - 1);
      await redis.set(`${prefix}:counter:${company}:${type}`, startAt);
      console.log(`Set ${prefix}:counter:${company}:${type} = ${startAt} (next call returns ${startAt + 1})`);
    }
  }

  console.log('Migration complete.');
}

main().catch(err => { console.error(err); process.exit(1); });
