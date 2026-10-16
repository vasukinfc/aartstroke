# Aart Stroke — Dynamic Production Workflow

Static pages are retained in HTML to preserve the current form and print layout. Order records use Cloudflare D1 through the Worker API.

## Files
- `index.html` — dashboard
- `production-form.html` — production/approval form, records and export
- `making-process.html` — stage editor and progress
- `worker.js` — D1-backed REST API
- `wrangler.toml` — Cloudflare Worker + D1 binding

## Backend setup
1. Confirm the `aartstroke-production` D1 database exists. It has been created and the `orders` table initialized in the connected Cloudflare account.
2. Configure static assets and hostname/routes first; the current Worker script is an API module and does not currently bundle the form HTML pages. 3. Set the `ADMIN_TOKEN` Worker secret to a long random string before allowing write requests:
   `npx wrangler secret put ADMIN_TOKEN`
4. Deploy: `npx wrangler deploy`
5. Run `npx wrangler d1 execute aartstroke-production --remote --command "CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, order_no TEXT NOT NULL, saved_at TEXT NOT NULL, data_json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_orders_saved_at ON orders(saved_at);"`
6. Configure static assets for the Worker in Cloudflare or GitHub Pages so the HTML files are served from the site's root.

## Important security note
`GET /api/orders` returns production records and should be protected by Cloudflare Access or changed to require user authentication before production use. Writes are denied unless an `ADMIN_TOKEN` secret is set and sent as `x-admin-token`. Do not put that admin token into public HTML/JavaScript; use an authenticated server/session flow instead.

## Per-order Making Process
- Every saved order stores its own `data.process` object (`stages` + `progress`).
- Use **Process** beside a specific row in Order Records, or select the order in Making Process.
- The process editor reads an explicit `?orderId=...` and saves/reset only that order. It does not copy another order's process when using **Save as New**.
- Stage updates are synced through the D1-backed API when the API is reachable. The admin token is requested at runtime and kept only for the current browser session; do not hard-code it into HTML.

## Data migration
Browser `localStorage` orders are per-browser and are not automatically imported into D1. Export CSV/Excel from the production form or build a one-time trusted import if records must migrate.
