# Clip

**Live: https://abdullahsattarofficial-a11y.github.io/Clipper/**

AI-powered video highlights and trimming that runs in the browser. Upload a
video, let Gemini or Groq find the good moments, fine-tune the range, and export
the clip — the trimming happens locally via ffmpeg.wasm, so the video never
leaves your machine for that step.

> The live site currently runs in **bring-your-own-key** mode: open Settings and
> paste a free Gemini or Groq key. Deploying the Worker (below) makes it work
> with no setup for everyone.

## Architecture

```
GitHub Pages (static frontend)          Cloudflare Worker (holds the API keys)
┌──────────────────────────┐            ┌──────────────────────────────┐
│  React + Vite            │  small     │  /gemini/upload-init         │
│  ffmpeg.wasm (local trim)│─── JSON ──▶│  /gemini/generate            │
│                          │            │  /gemini/file                │
│                          │            │  /groq/transcribe            │
└───────────┬──────────────┘            └──────────────┬───────────────┘
            │                                          │ key attached here
            │  video bytes go DIRECT to Google         ▼
            └────────────────────────────────▶  Gemini / Groq APIs
```

Two things worth knowing about that diagram:

**The API keys are never in the frontend.** Anything bundled into client-side
JavaScript is readable by anyone who opens DevTools — minifying or encoding it
changes nothing. The keys live as Cloudflare Worker secrets, and the browser
talks to the Worker instead.

**Video bytes don't pass through the Worker.** Gemini's resumable upload URL is
self-authorizing via its `upload_id`, so the Worker mints the URL with its key,
strips the key out, and hands back a bare URL. The browser uploads straight to
Google. That keeps large uploads off the Worker and well inside the free tier.

## Setup

### 1. Deploy the API proxy

See [worker/README.md](worker/README.md). Roughly:

```bash
cd worker
npm install
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GROQ_API_KEY
# edit ALLOWED_ORIGINS in wrangler.toml to your Pages URL first
npx wrangler deploy
```

Note the deployed URL — something like `https://clip-web-api.<you>.workers.dev`.

### 2. Configure the frontend

```bash
cp .env.example .env
# set VITE_API_PROXY_URL to your Worker URL
npm install
npm run dev
```

### 3. Deploy to GitHub Pages

1. Push the repo to GitHub.
2. **Settings → Pages → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions → Variables** → add a repository
   variable `VITE_API_PROXY_URL` with your Worker URL. It's a *variable*, not a
   secret, because it's a public URL — the Worker is protected by its origin
   allowlist and rate limiter, not by keeping the URL hidden.
4. Push to `main`. The workflow in
   [.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds and
   publishes automatically.

Leaving `VITE_API_PROXY_URL` unset is valid — the app then runs in
bring-your-own-key mode, where each user supplies their own key in Settings.

## Users can bring their own key

The Settings panel accepts a personal Gemini or Groq key. When one is present it
takes priority over the proxy and goes straight to the provider, so the user's
key stays in their browser and never reaches our infrastructure. This is also
the escape hatch when the shared quota is rate-limited.

## Security notes

| Concern | How it's handled |
| --- | --- |
| API keys in the client bundle | Removed. Keys are Cloudflare Worker secrets; the frontend holds none. |
| `.env` reaching the repo | Gitignored. `.env.example` documents the shape, contains no secrets. |
| Anyone abusing the open proxy | Origin allowlist + per-IP rate limit (20 req/min), both failing *closed* if misconfigured. |
| SSRF through the proxy | Routes are a fixed allowlist; no client-supplied URL or path is ever interpolated into an upstream request. Model names are pinned server-side. |
| XSS stealing a saved user key | Strict CSP in `index.html` — `connect-src` limits where any injected script could send data. React escapes all AI-generated text; there is no `dangerouslySetInnerHTML` anywhere. |
| Oversized uploads crashing the tab | 500MB client-side cap before anything allocates; 25MB cap on audio sent for transcription. |
| Dependency CVEs | `npm audit` clean as of the Vite 6 upgrade. CI runs `npm ci` against the lockfile. |

### Known limitations, stated plainly

- **A proxy protects the key, not the quota.** Anyone who finds the Worker URL
  can spend your free tier. The origin allowlist stops other *websites* (browsers
  won't let page JS forge `Origin`) but not a determined person with `curl`. The
  rate limiter is what bounds that. Watch your usage; consider Cloudflare
  Turnstile if it becomes a problem.
- **CSP needs `style-src 'unsafe-inline'`** because the UI is built with React
  inline styles. Moving those into CSS classes would let you drop it.
- **`connect-src` allows `https://*.workers.dev`**, which is broader than
  necessary. Narrow it to your exact Worker URL in `index.html` once deployed.
- **Google Fonts is a third-party request** that exposes visitor IPs to Google.
  Self-hosting the Outfit font would remove it and let you tighten `style-src`
  and `font-src`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built output locally |
| `npm run lint` | Oxlint |

## Browser support

Needs WebAssembly and `SharedArrayBuffer`-free ffmpeg (this uses the
single-threaded `@ffmpeg/core`, so no COOP/COEP headers are required — which is
what makes GitHub Pages viable as a host). Works on current Chrome, Edge, Safari,
Firefox, and their mobile counterparts.
