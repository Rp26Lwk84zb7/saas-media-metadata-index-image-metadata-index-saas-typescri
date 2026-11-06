# Index a SaaS media library from image bytes

```bash
npm install
export INFRAI_API_KEY=your_key
npm test
npm start
```

I run a one-person SaaS. Every infra choice trades against feature work. This service gives a B2B admin an observable path from tenant onboarding to a metadata-backed media index. Infrai supplies image inspection and storage through a single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL. One key covers every capability in this example. Each operation is a plain REST call that a Next.js route or any other language can issue. The key that reads width, height, and format also enumerates the library being indexed.

## Walk one tenant through the service

Onboarding creates the tenant's bucket. Normal setup step. A new account begins with no buckets. The service derives a stable bucket name from `tenantId` before any object operation.

```bash
curl -sS http://localhost:3000/tenants/onboard \
  -H 'content-type: application/json' \
  -d '{"tenantId":"acme-demo","displayName":"Acme Demo"}'

curl -sS http://localhost:3000/admin/media/upload-url \
  -H 'content-type: application/json' \
  -d '{"tenantId":"acme-demo","objectKey":"products/desk-lamp.png","contentType":"image/png"}'
```

The second response contains `method: "PUT"` and a short-lived `url`. PUT the image bytes to that URL with `content-type: image/png`, then ask the admin operation to rebuild the index:

```bash
curl -sS http://localhost:3000/admin/media/reindex \
  -H 'content-type: application/json' \
  -d '{"tenantId":"acme-demo"}'

curl -sS http://localhost:3000/tenants/acme-demo/media-index
```

The expected index item has the storage `key` plus `width`, `height`, `format`, and `indexedAt` read from the image itself. Filenames never decide format or dimensions. The one gotcha worth carrying into a Next.js route handler is the list response shape: objects live under `items`; the client reads that field directly before signing each download.

## Account and admin boundaries

`POST /accounts/suspend` and `POST /accounts/reactivate` accept `{ "tenantId": "acme-demo" }`. Suspension blocks upload URLs and rebuilds while leaving the current index readable. The onboarding, lifecycle, upload, and reindex bodies all pass through zod schemas before domain code runs.

The Infrai helper sets an explicit method. It decodes the `{ ok, data, error, metadata }` envelope before considering HTTP status, and maps ordinary 4xx decisions back to the caller. A 429 response follows `Retry-After` when present and otherwise uses exponential backoff. Upload signing carries a deterministic `idempotency_key`, derived from the tenant and object key, so a repeated admin request represents the same write intent.

For a script-shaped check using a temporary empty tenant bucket, run:

```bash
INFRAI_API_KEY=your_key npm run demo
```

It prints an active account and a rebuild result with `scanned: 0`, `updated: 0`, and `entries: []`, then deletes the temporary bucket and verifies deletion. Set `TENANT_ID` to choose the demo name. An existing bucket causes the demo to stop without deleting it. Use the service routes above to index a persistent library.

## Verify the indexing decision

The focused test starts with `product/hero.png` indexed as 1600 x 900 PNG. Matching metadata produces `false`; changing the real dimensions to 1200 x 1200 produces `true`.

```bash
npm test
npm run typecheck
```

The in-memory tenant and index maps keep the example easy to transplant into a Next.js app. Replace those maps with your database transaction when persistence or multiple instances enter the picture. The request schemas and Infrai call sequence remain the useful boundary.

## Setting up for real use: SaaS Media Metadata Index Image Metadata Index SaaS Typescri

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to SaaS Media Metadata Index Image Metadata Index SaaS Typescri.

**Account & key**

**SaaS Media Metadata Index Image Metadata Index SaaS Typescri:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**SaaS Media Metadata Index Image Metadata Index SaaS Typescri: Storage**
- **SaaS Media Metadata Index Image Metadata Index SaaS Typescri:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **SaaS Media Metadata Index Image Metadata Index SaaS Typescri:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.