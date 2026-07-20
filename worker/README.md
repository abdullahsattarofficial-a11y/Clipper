# clip_web API proxy

A Cloudflare Worker that holds the Gemini and Groq API keys so the frontend
doesn't have to. Free tier is 100,000 requests/day, which is far more than this
app will use.

## Why this exists

GitHub Pages serves static files. There is no server, so any key the frontend
uses is extractable from the JavaScript bundle — obfuscation doesn't help. This
Worker is the smallest thing that can hold a key on the server side.

## Deploy

```bash
npm install
```

**1. Set the allowed origins.** Edit `ALLOWED_ORIGINS` in `wrangler.toml` to your
real GitHub Pages origin (scheme + host, no trailing slash, no path):

```toml
ALLOWED_ORIGINS = "https://your-username.github.io,http://localhost:5173"
```

If this is empty the Worker rejects everything. That's deliberate — a
misconfigured proxy should be closed, not open.

**2. Set the secrets.** These are prompted for and stored by Cloudflare; they
never touch the repo:

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GROQ_API_KEY
```

**3. Deploy.**

```bash
npx wrangler deploy
```

Take the resulting URL and set it as `VITE_API_PROXY_URL` in the frontend's
`.env` (local) and as a repository variable in GitHub Actions (production).

## Local development

```bash
npm run dev   # wrangler dev, serves on http://localhost:8787
```

Point the frontend's `.env` at `http://localhost:8787`. The dev server reads
secrets from a `.dev.vars` file — create one locally (it's gitignored):

```
GEMINI_API_KEY=...
GROQ_API_KEY=...
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness check; the only route open without an allowed origin. |
| `POST` | `/gemini/upload-init` | Mints a resumable upload URL with the key **stripped out**, so the browser can upload video bytes straight to Google. |
| `GET` | `/gemini/file?name=files/x` | Poll upload processing status. |
| `DELETE` | `/gemini/file?name=files/x` | Delete an uploaded file. |
| `POST` | `/gemini/generate` | `generateContent` — transcription and highlight scoring. |
| `POST` | `/groq/transcribe` | Whisper transcription (multipart audio). |
| `POST` | `/groq/chat` | Llama highlight scoring. |

## Security design

- **Fixed route allowlist.** The client never supplies a URL, host, or path
  fragment that gets interpolated into an upstream request. Without this the
  Worker would be an SSRF relay that signs arbitrary requests with your keys.
- **Pinned models.** Model names are chosen server-side, so a caller can't
  select an expensive model on your budget.
- **Rebuilt payloads.** Only the fields the app actually sends are forwarded;
  everything else is dropped rather than passed through.
- **Fails closed.** Missing `ALLOWED_ORIGINS` → 403. Missing rate limiter
  binding → 429. An unmetered public proxy is worse than a broken one.
- **Validated file names.** `files/[A-Za-z0-9_-]{1,128}`, anchored, no slashes,
  so a caller can't traverse into another API surface.
- **Truncated error relaying.** Upstream error bodies are capped at 500 chars
  and generic on unexpected failures, so a stack trace from a key-bearing
  request never reaches a stranger.

### The tradeoff to be aware of

This protects the *key*, not the *quota*. Anyone who finds the Worker URL can
spend your free tier. `Origin` allowlisting genuinely stops other websites
(browsers won't let page JS forge that header) but not someone using `curl`. The
per-IP rate limit is what bounds real abuse. If it becomes a problem, add
[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/).

## Tuning the rate limit

In `wrangler.toml`:

```toml
simple = { limit = 20, period = 60 }   # 20 requests per minute per IP
```

A full analysis run is a handful of requests plus polling, so 20/min is roomy for
one user and tight enough to make scripted abuse tedious.
