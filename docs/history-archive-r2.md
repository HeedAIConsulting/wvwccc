# Chamber History Archive → Cloudflare R2

The legacy site holds ~6.2 GB of historical event/promo media worth preserving as
a "Chamber History" gallery, but it should NOT live in the live deploy or git.
Plan: push it to **Cloudflare R2** (cheap, zero-egress object storage) and surface
it via a lazy-loaded gallery.

## What's in the archive (curated, dedup'd)
- **20,482 files, 6.2 GB** total
  - photos (event/promo, high-res): 13,386 / 3.3 GB
  - documents (newsletters, programs, flyers PDFs): 1,328 / 1.5 GB
  - event photos: 5,658 / 1.2 GB
  - ads/banners: 110 / 151 MB
- **Excluded** (not uploaded): member-profile photos (already live in `images/members/`),
  the `productphotos_nc` duplicate set (2.2 GB), nested `old_woodlandhills`/`BAK` backups,
  thumbnails. File list: `E:\WVWCCOC\history_archive_files.txt`.

## Cost
R2: **$0.015/GB/month, $0 egress.** 6.2 GB ≈ **$0.10/month.** Class-A writes for the
one-time upload (~20k objects) are negligible (<$0.10 total).

## Status
- ✅ R2 enabled; bucket **`wvwccc-history`** created (region ENAM)
- ✅ Archive curated + file list (`E:\WVWCCOC\history_archive_rel.txt`, 20,482 paths)
- ✅ Gallery built: `community/history.html` + `data/history-index.json` (lazy infinite-scroll, category filters)
- ⬜ **YOUR ACTIONS:** create an R2 API token → run the rclone upload → enable public access → send me the r2.dev URL

## Step A — create an R2 API token (dashboard)
Cloudflare → **R2** → **Manage R2 API Tokens** → **Create API token**:
- Permission: **Object Read & Write**, scoped to bucket `wvwccc-history`
- Note the **Access Key ID**, **Secret Access Key**, and your **Account ID**
  (the S3 endpoint shown is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`)

## Step B — upload (run locally, ~6.2 GB, one time)
```powershell
# configure the remote once
rclone config create r2 s3 provider=Cloudflare `
  access_key_id=<KEY> secret_access_key=<SECRET> `
  endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com

# upload the curated set; R2 keys preserve the path under httpdocs/
rclone copy --files-from E:\WVWCCOC\history_archive_rel.txt `
  "E:\WVWCCOC\var\www\vhosts\woodlandhillscc.net\httpdocs" `
  r2:wvwccc-history --transfers 16 --progress
```
(rclone handles 20k files + resume far better than `wrangler r2 object put`.)

## Step C — make it viewable
Cloudflare → R2 → **wvwccc-history → Settings → Public access** → enable the
**r2.dev** managed URL (or attach a custom domain like `history.woodlandhillscc.net`).
Copy the public base URL (e.g. `https://pub-xxxx.r2.dev`) and send it to me — I set
`R2_BASE` in `community/history.html` and the gallery goes live.

## Notes
- `data/history-index.json` (2.3 MB) is committed so the static gallery works on Pages.
- Index keys exactly match the rclone-uploaded R2 keys (path under httpdocs).
