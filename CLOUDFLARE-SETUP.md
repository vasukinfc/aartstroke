# AART STROKE — Cloudflare setup for the VasukiNFC account

> Account screenshot on 17 October 2026 showed only two Workers: `vasuki-nfc-activate` and `vasuki-nfc-website`. **Do not change those Workers.** AART STROKE needs its own Worker named `aartstroke`.

## Important correction

The account subdomain shown in Cloudflare is `vasukinfc.workers.dev`. Cloudflare's default Worker URL is `<worker-name>.<account-subdomain>.workers.dev`.

For this project the frontend API is:

```
https://aartstroke.vasukinfc.workers.dev/api
```

Older code had the wrong URL `https://aartstroke.workers.dev/api` and would not work in this account. The correct URL has been updated in `api-client.js`, `login.html`, and `approval.html`. There is no default workspace key.

## 1. Verify the D1 database FIRST

In Cloudflare, open **Storage & databases → D1** and look for `aartstroke-production`.

- **If it already exists in the selected account:** open the database and check its database ID. It must match the `database_id` entry in `wrangler.toml`. **If the IDs differ, update `wrangler.toml` to the actual database ID before deploying.** Do not delete the existing database or create another copy.
- **If it does not exist:** create a D1 database called `aartstroke-production`. Copy the new database ID from the dashboard into the `database_id` field in `wrangler.toml`. The ID in the repository is from the original project configuration; it must not be assumed to be valid in a different account.
- If your customer-data backup is from another database, only import it after reviewing the contents and preparing a restore procedure. **Do not overwrite real records with a blank schema.**

## 2. Create the private artwork bucket

In Cloudflare, open **Storage & databases → R2 Object Storage**, create the private bucket `aartstroke-artworks`. If it already exists in this account, reuse it. Do not enable a public bucket URL.

The repository's `wrangler.toml` includes:

```toml
[[r2_buckets]]
binding = "ARTWORKS"
bucket_name = "aartstroke-artworks"
```

## 3. Deploy the Worker from the website ZIP

You need Node.js and PowerShell on Windows. Extract the latest release ZIP. Inside the folder that contains **`wrangler.toml`**, run:

```powershell
node --version
npx wrangler login
npx wrangler d1 list
```

Check that `aartstroke-production` is present and its **database ID matches wrangler.toml**. Next run:

```powershell
npx wrangler d1 execute aartstroke-production --remote --file=./schema.sql
npx wrangler deploy
```

The schema uses `CREATE TABLE IF NOT EXISTS` and does not delete or replace existing orders. The second command creates or updates the **`aartstroke`** Worker in the signed-in Cloudflare account.

Cloudflare should display:

```
https://aartstroke.vasukinfc.workers.dev
```

If it shows a different account subdomain, **do not proceed**: check your login/account selection and update the frontend API accordingly.

## 4. Create the private access key (not a GitHub password)

Run:

```powershell
npx wrangler secret put ADMIN_TOKEN
```

Type a **new, strong, unique secret** of at least 20 characters when prompted. It must remain private. Do not add it to GitHub, commit it to a file, or send it by chat or screenshots.

The sign-in page checks the Worker session endpoint with this key. The current workspace uses one shared access key; it does not have independent employee accounts.

## 5. Test

1. Open <https://aartstroke.vasukinfc.workers.dev/api/health> and verify JSON with `ok: true` and `database: true`.
2. Open <https://aartstroke.vasukinfc.workers.dev/api/session> in an ordinary browser tab. It should respond with HTTP 401 without an access key. That is expected: the API is protected.
3. Open <https://vasukinfc.github.io/aartstroke/> and sign in with your newly configured private key.
4. Create **one TEST order**; verify that Save Order succeeds. Upload a sample original artwork, download it, test XLSX, archive/restore and approval link.
5. Verify the correct customer orders from your old backups or existing D1 database. Never assume a green GitHub Pages build means backend data has been restored.

## If you want to do setup entirely through the Cloudflare dashboard

You can create R2 and D1 using the dashboard, but the actual Worker script `worker.js`, its API secret and both bindings still need to be deployed correctly. The `wrangler deploy` route above is the simplest repeatable deployment using this source repository.

## Troubleshooting

- **Only two Workers listed:** the AART STROKE Worker has not been created in the selected Cloudflare account. The Wrangler deployment adds a third Worker.
- **Wrong access key / unauthorized:** check the `ADMIN_TOKEN` Worker secret and whether `worker.js` has been deployed.
- **Worker not updated yet (404 on `/api/session`):** deploy this repository's latest `worker.js` rather than trying random keys.
- **Database not configured:** check D1 database ID and `DB` binding in `wrangler.toml`.
- **Cannot store original artwork:** check R2 bucket name `aartstroke-artworks` and `ARTWORKS` binding.
- **Failed deployment due to missing R2:** create the bucket first.
- **Login page loads but signing in fails:** check the developer console/network response for the `/api/session` call. Login is only usable once the Worker code, D1 binding and secret are set up.
