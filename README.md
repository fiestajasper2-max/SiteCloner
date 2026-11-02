# Site Cloner (deep)

Paste a public URL → frontend mirror + asset pack + backend map + live proxy.

## What you get

| Layer | What happens |
|---|---|
| **Frontend** | HTML fetched, all resource URLs rewritten absolute, forms keep absolute actions |
| **Assets** | Up to 40 CSS/JS/images/etc downloaded into the ZIP under `assets/` |
| **Offline HTML** | Same page with successful assets pointing at local relative paths |
| **Backend map** | Forms (method/action/inputs) + endpoints scraped from inline scripts (`fetch`, `axios`, XHR, `/api/*` paths) |
| **Live proxy** | `GET/POST/PUT/PATCH/DELETE /api/proxy?u=<original>` forwards to the origin so the clone can keep talking to the real backend under same-origin rules |

True server source (Node/PHP/Python/etc) cannot be reconstructed without the origin's code. The proxy is how the clone stays "backend-aware".

## Local

```bash
npm install
npm run dev
```

Open http://localhost:3000 → paste URL → Clone → Download ZIP.

## Vercel

```bash
npx vercel
```

Or connect the Git repo. No env vars required.

`vercel.json` sets:
- clone route: 60s maxDuration
- proxy route: 25s maxDuration

## ZIP contents

```
index.html          # offline HTML (local asset paths where fetched)
assets/             # downloaded CSS/JS/images
manifest.json       # source URL, forms, endpoints, stats
backend-map.md      # human-readable endpoint + form list
```

## Limits

- Private/localhost targets blocked (no open proxy abuse)
- Asset download capped (default 40) to stay inside serverless time/memory
- Heavy SPAs that only paint after client JS need those scripts to run
- Auth cookies / CSRF tokens still belong to the original origin; proxy forwards `cookie` + `authorization` when present
