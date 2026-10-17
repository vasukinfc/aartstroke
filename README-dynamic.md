# AART STROKE — Production Workspace (upgrade branch)

AART STROKE is a labels & packaging production application with three public static HTML pages and a private-data Cloudflare Worker/D1 API.

> **Deployment gate:** This branch is a draft PR. Do not merge or deploy to the live workflow until Cloudflare settings, an export of existing data and production smoke tests are completed. These changes do **not** modify the current live site until merged and deployed.

## What is included
- New responsive dashboard, order search/filter, production summary and archived order restore.
- Existing printable approval form retained; validations, revision-aware shared saves, draft cache, safer archive and genuine .xlsx export.
- Making Process editor now supports an assigned employee and stage remarks.
- API reads and writes now require an authorization token; DELETE /api/orders (all) is blocked.
- Cloudflare D1 keeps active orders and automatically creates a `orders_trash` table on archive/restore.
- Optional private Cloudflare R2 originals: `POST /api/artwork` saves original bytes, `GET /api/artwork/<id>/<file>` retrieves them after authentication. The form keeps compressed preview data for print layout and reports whenever original storage is unavailable.
- Node built-in tests and GitHub Actions check workflow.

## Files
| File | Purpose |
|------|---------|
| `index.html` | Dashboard and Trash UI |
| `production-form.html` | Data entry, artwork preview, print, records and exports |
| `making-process.html` | Per-order stage tracking, assigned employee, remarks |
| `api-client.js` | Authenticated API client; token scoped to a browser tab |
| `xlsx-export.js` | Local .xlsx export, no external CDN |
| `worker.js` | D1-backed protected API and optional R2 storage |
| `wrangler.toml` | Existing Worker + D1 binding |
| `tests/smoke.test.mjs` | Test suite |

## Step 1: Back up all existing data BEFORE deployment

1. In the current website, export the order list to CSV or Excel. Note that the **old** Excel was HTML with an .xls filename and does not include the actual artwork bytes. Do not treat it as a full backup.
2. Export the D1 database to a secured local path while authenticated to the correct Cloudflare account:

   ```bash
   npx wrangler d1 export aartstroke-production --remote --output ./aartstroke-pre-upgrade.sql
   ```

3. Preserve browser-local orders on machines used for production. Legacy local-only records are preserved in the browser cache by this update, but are **not automatically uploaded**. Save/import each one after confirming the shared database is connected.
4. Do not delete the browser cache, destroy the D1 database, or overwrite existing artwork files during upgrade.

## Step 2: Configure the existing Cloudflare Worker

This project already has a D1 database called `aartstroke-production`. Do not create a new database if it contains existing orders.

Set a long randomly generated secret (not in GitHub source code):

```bash
npx wrangler secret put ADMIN_TOKEN
```

This temporary protection uses a shared access token requested in the UI for each browser tab and stored in `sessionStorage`. It is a **temporary admin access mechanism, not individual employee login/roles**. Share it only with trusted authorized personnel. Do not put it in HTML, screenshots, source code or URLs. Later replace it with Cloudflare Access/OIDC identity and authorization on every API route.

Worker deployment (ONLY after the deployment gate passes):

```bash
npx wrangler deploy
```

The static GitHub Pages site is a **separate** deployment. Coordinate the Worker and HTML rollout: older deployed pages may not be able to list records once authenticated reads are enabled. Plan a quiet maintenance window.

## Step 3: Optional original artwork storage (recommended before production)

Cloudflare R2 requires account access and a bucket, which cannot be configured merely by committing this repository:

```bash
npx wrangler r2 bucket create aartstroke-artworks
```

After creating the bucket, add the following to `wrangler.toml` in your deploy configuration:

```toml
[[r2_buckets]]
binding = "ARTWORKS"
bucket_name = "aartstroke-artworks"
```

Then deploy the Worker. Keep the bucket private, set a retention/backup policy and monitor storage usage. Files have a 15 MB limit in this initial implementation. The current uploader supports PNG, JPEG, WebP and SVG; PDF is supported by the API but **not yet by the current preview uploader**. CDR/AI/PSD production-original support and virus/content scanning require additional work.

When R2 isn't bound, the UI warns that the **original has not been saved**, although a compressed preview may still be saved with the order. A compressed preview is not a safe print-master replacement.

## Step 4: Deployment smoke tests

From an authorized environment, verify all of the following:

- `GET /api/health` reports an available database.
- Unauthenticated `GET /api/orders` returns HTTP 401.
- Authorized `GET /api/orders` loads existing records without modifying them.
- Creating one TEST order, editing it, and updating a Making Process stage works.
- Editing stale revisions returns HTTP 409; newer data is not overwritten.
- Archive a TEST order, locate it in Trash, restore it, and verify its contents.
- Bulk `DELETE /api/orders` returns HTTP 403 even for an authorized user.
- Upload an original artwork and confirm R2 returns its key (only if R2 is enabled); print preview keeps correct fit.
- Export the list and a single order as genuine `.xlsx`; open in desktop Excel and verify columns.
- Print to A4 from Chrome and Edge; check the full form and image alignment.
- Test mobile-sized viewport, slow network, server down, oversized images and storage quota exhaustion.
- Confirm user edits on two devices produce conflict warnings instead of silent overwrite.
- Run `npm test` in Node 20+.

## Known limitations — not yet production-complete

- **Individual employee identity and roles:** The shared token is not an employee login. Restrict access with Cloudflare Access/OIDC and add server-side roles before broad rollout.
- **Customer approval:** The existing signature-name field is NOT a cryptographic signature, consent audit or verifiable customer approval. A separately authenticated customer proofing workflow still needs building.
- **Automatic backups:** No scheduled R2/D1 backup and restore verification is installed by this PR. Configure durable external backups and test restores.
- **Original artwork:** R2 bucket/binding is not yet configured. PDF, SVG conversion and print preflight require enhancement.
- **Browser local history:** Legacy local-only orders require a one-time migration and reconciliation. The browser cache is not a reliable long-term backup.
- **Large datasets:** The dashboard has a 100-row display limit and the Worker currently returns up to 1000 active records per request. Pagination, server-side search, and artwork separation are needed before very large adoption.
- **Advanced operations:** Job QR cards, customer portal, revision approval, SMS/WhatsApp alerts, weighted process metrics, due date alerts, production audit timelines and analytics remain future scope.

## Release policy

- Use PR-based changes. Review differences and passing checks.
- Keep all existing D1 records and original artwork safe; take backups before mutations.
- Validate the new Worker against a test/staging D1 database before live deployment.
- Never auto-merge/auto-deploy code that changes database security or writes.
