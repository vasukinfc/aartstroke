# AART STROKE — Production Workspace (upgrade branch)

AART STROKE is a labels & packaging production application with three public static HTML pages and a private-data Cloudflare Worker/D1 API.

> **Deployment gate:** This branch is a draft PR. Do not merge or deploy to the live workflow until Cloudflare settings, an export of existing data and production smoke tests are completed. These changes do **not** modify the current live site until merged and deployed.

## What is included
- New responsive dashboard, order search/filter, production summary and archived order restore.
- Existing printable approval form retained; validations, revision-aware shared saves, draft cache, safer archive and genuine .xlsx export.
- Making Process editor now supports an assigned employee, due date, overdue indication and stage remarks.
- API reads and writes now require an authorization token; DELETE /api/orders (all) is blocked.
- Cloudflare D1 keeps active orders and automatically creates `orders_trash` on archive/restore and `orders_history` on edits and history queries. Historical revisions can be restored without destroying the latest version.
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
- Editing stale revisions returns HTTP 409; newer data is not overwritten. Check History → Restore on a TEST order and verify a new revision is created.
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
- **Advanced operations:** Job QR cards, customer portal, verifiable revision approval, SMS/WhatsApp alerts, weighted process metrics, production audit timelines and advanced analytics remain future scope. Basic per-stage due dates and dashboard overdue counts are implemented.

## Release policy

- Use PR-based changes. Review differences and passing checks.
- Keep all existing D1 records and original artwork safe; take backups before mutations.
- Validate the new Worker against a test/staging D1 database before live deployment.
- Never auto-merge/auto-deploy code that changes database security or writes.


## October 17 release candidate — additional working features
- `login.html` provides a dedicated workspace sign-in. The access key must match the Cloudflare Worker `ADMIN_TOKEN` secret. This is **not** a multi-user identity/roles system. Every authorized staff member currently has the same access level.
- Worker allocates unique `ORD-0001`-style numbers atomically in D1 via the `order_counters` table; existing historic order numbers remain unchanged.
- Orders paginate in the API and client, up to the configured client cap of 10,000 orders.
- Deleting an order moves it to Trash. Browser-only legacy records are saved separately as `production-legacy-backup` and are not silently reintroduced into the live order list.
- `approval.html` lets customers review a specific proof revision and approve/request changes through a **single-use 64-digit token**. An authenticated staff user clicks **Customer Approval Link** on a saved order to generate a proof link valid for 3 days. Token hashes are stored in D1; the raw token is not stored in the database. Admins can see approval status in the production form. This is a proof of decision from possession of a private link and a typed name; it is **not** a legally certified digital signature or separate identity verification.
- Originals stored in R2 can be downloaded by authorized staff using the **Download Original Artwork** button. The visible artwork backup warning remains until an original is uploaded.
- GitHub Actions `Test and package release ZIP` creates a complete source-code ZIP artifact only after automated tests pass.

### First-run deployment checklist

1. Secure a verified D1 export/backup before modifying the existing Cloudflare Worker.
2. Configure `ADMIN_TOKEN` as a Worker secret, without placing it in GitHub, and choose who is authorized to know it.
3. Create the R2 bucket `aartstroke-artworks`, add the `ARTWORKS` binding as documented above, and confirm upload **and download** using one non-sensitive sample original.
4. Confirm the existing `DB` D1 binding is the intended production database; no copy/migration into an empty database should silently replace existing data.
5. Deploy Worker code first in a **staging environment with a copied test D1 database**. Check order reads, writes, revision conflict, archive/restore, authenticated R2, and public single-use approval links.
6. Deploy the production Worker and the GitHub Pages HTML as one coordinated release; the new sign-in requires authenticated `GET /api/orders`.
7. Test A4 print with a real sample label, desktop Excel opening a new `.xlsx`, mobile screens, and offline/server outage recoverability.
8. Keep automated tests green and monitor Worker logs after release.

### Security and deployment notes

- Customer approval token URLs are capability links. Anyone holding an unexpired link may act for that specific revision once; share only with the intended customer using a secure channel. If a link leaks, create a new artwork revision to invalidate previous links. Configurable revoke endpoints remain future work.
- This is a single-tenant administrative product with a shared staff access key. Organization-scale usage requires individual accounts/roles and better account recovery.
- R2 provisioning, D1 backup operations, DNS/routes, Worker secrets, Cloudflare Access, production release coordination, and real hardware printing require an authorized Cloudflare environment. CI passing does not provision those services.
- No automatic production deployment is performed by these commits. The GitHub branch/PR can be reviewed, and the release ZIP contains code/config only (no databases, customer records or secrets).
