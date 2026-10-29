# Vasuki NFC Production Hub — staging release gate

This is the existing Aart Stroke labels/packaging order system rebranded for Vasuki NFC. **Never rename the existing D1 database, worker domain, JSON schema, local-storage identifiers, or order IDs without an independently verified migration.** Visible application labels now use Vasuki NFC. The Aart Stroke repository path and worker URL intentionally remain unchanged.

## Included in this branch

- Vasuki NFC name, hosted Vasuki favicon, black/ivory design accents on dashboard, forms, login, proof and Making Process.
- Production dashboard pagination and summary-only API responses to avoid transferring artwork previews to dashboard.
- Form update revision metadata retained. Prior bug could send revision 0 for existing orders.
- Date/time regex repaired; existing saved dates remain backward compatible.
- Default workflow for **new** orders places Customer Approval before Printing. Existing orders keep their own saved stages and order numbers.
- Server rejects a newly started Printing stage until a valid approval exists for the current **proof version**.
- Separate proof version avoids invalidating an artwork approval merely because a process stage was updated. Changing artwork, size, quantity or other form fields produces a new proof version.
- Optional role-based staff access keys: admin / production / viewer. Legacy `ADMIN_TOKEN` stays an administrator key until deliberately rotated.
- PDF originals can upload to R2 without a browser preview; they must be downloaded for actual print production. Images remain as compressed previews; previews are not print-ready originals.
- Existing history, trash, optimistic concurrency safeguards, sequential order numbers and XLSX export remain unchanged.

## Cloudflare setup — explicit operator actions

**Do NOT deploy without a verified backup and staging test. No secrets are committed.**

1. Export existing D1 (from an authenticated Cloudflare CLI profile) to a secure local destination:
   `npx wrangler d1 export aartstroke-production --remote --output ./aartstroke-backup-YYYYMMDD.sql`
2. Verify the exported SQL actually contains `orders` and non-empty row data where expected, and keep an encrypted offsite copy.
3. Back up browser-local legacy records from every active machine: in the form's export controls choose CSV/XLSX; confirm older local-only records in `production-legacy-backup` separately. Do not clear browser storage.
4. Provision a PRIVATE R2 bucket in the same Cloudflare account (only if approved/available). Add to the deployment config:

   ```toml
   [[r2_buckets]]
   binding = "ARTWORKS"
   bucket_name = "vasuki-nfc-production-artworks"
   ```

   Only use that name if you actually created the bucket. An existing private R2 bucket can be reused, without migrating original objects. Never recreate the D1 DB.
5. Worker secrets: `ADMIN_TOKEN` must be a strong random string in Cloudflare secrets, never in JavaScript, GitHub variables, or screenshots. To enable individual employee keys, configure the **secret** `STAFF_ACCOUNTS` as a JSON array:

   ```json
   [{"id":"operator-1","name":"Production Staff","role":"production","tokenHash":"SHA256_HEX_OF_A_LONG_RANDOM_ACCESS_KEY","enabled":true}]
   ```

   Generate hashes locally (do not paste access keys into online hash tools): `node -e "console.log(require('node:crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "YOUR_LOCAL_RANDOM_KEY"`. Supported roles: `admin` can archive/restore; `production` can create/edit orders and request customer proofs; `viewer` is read-only. This is **key-based access**, NOT fully managed user accounts, MFA or OIDC.
6. Deploy worker + Pages content together during a maintenance window, **after** staging checks. The existing external worker URL is deliberately unchanged.
7. Smoke-test as administrator, production staff, and viewer; confirm direct API calls reject forbidden actions, not merely hide UI controls.
8. Confirm R2 upload, re-download, original byte equality, permission checks and PDF cases. If R2 is not provisioned, do not claim original storage works.
9. Confirm artwork approval before Printing using a test order. Confirm proof persists after only progress changes and invalidates after changes to print specifications.
10. Confirm 409 concurrent editing, archived order recovery, 10+ orders pagination, exports in actual Excel, A4 print in Chrome/Edge, mobile view, login/logout, slow and failed network, data restore from backup.
11. Run `npm test` with Node 22+ before deployment. The GitHub Actions checks must also pass.

## Still requiring infrastructure / further implementation

- Paid Cloudflare R2 bucket provisioning, routine offsite D1/R2 snapshots, and verified scheduled restore drills cannot be completed by a source-code PR.
- Full employee identity/SSO/MFA, account recovery and per-staff audit log (beyond `_lastEditedBy`) need a real identity provider and access policy.
- Bleed, Pantone/CMYK, editable CDR/AI print preflight and genuine printer testing are separate specialist production tasks.
- Production notification integrations (WhatsApp/SMS), dynamic QR job cards and analytics beyond stage counts need scoped implementation and external service configuration.
- Do not treat green CI alone as evidence that production Cloudflare credentials, real-world print sizing or customer data are safe.

## Rollback

If staged rollout fails, revert Pages and Worker to the last known-good commit **without reverting the D1 database or deleting R2 objects**. Existing records and keys should still be available; restore a SQL backup only after confirming the point-in-time and validating that newer orders will not be lost. Check successful login, legacy record opens, artwork references and A4 preview again.

## Repo state

This branch starts from draft PR #1's improved code and is not live until merged and GitHub Pages / Worker deployments are performed. New default form stages apply only to newly created records; loaded historical records remain unchanged.
