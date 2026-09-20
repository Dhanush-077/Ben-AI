# Ben AI — Project Brief (handoff doc)

B.Tech mini-project: a multi-modal AI chatbot named **Ben AI**. Built by
Janakisetty Dhanush Babu, B.Tech CSE 3rd Year, PBR Visvodaya Institute of
Technology and Science. Timeline: a few days (quick demo), so the stack is
chosen for speed of setup, not for scale.

## What it does
- Answers general/coding questions using a hosted chat model, with replies
  rendered as **markdown** (GFM tables, inline code, syntax-highlighted
  fenced code blocks — see `MarkdownMessage.jsx`).
- Answers news, stock, and sports questions using **live data**, fetched via
  tool-calling (the model decides when a question needs live data and calls
  the right function — no manual if/else routing).
- Returns relevant **images** and **source links** alongside answers.
- Accepts **text, voice, and image** input. Uploaded images are stored in a
  public Supabase Storage bucket (`chat-images`) and shown as thumbnails in
  the chat; corrupted/oversized uploads get a friendly 400 instead of a crash.
- **Multi-chat**: side-by-side conversation list with **+ New Chat**,
  auto-generated titles from the first message, **rename**, and **pin**
  (pinned threads sort first). Old pre-conversation history is preserved in
  an "Imported history" chat (see `migration.sql`).
- Requires **login (email + password)** so chat history survives across
  devices and isn't lost if the browser cache is cleared.
- **Copy / share** buttons on every assistant reply (Web Share API with a
  clipboard fallback).
- Dark mode (class-toggled on `<html>`), time-aware greeting with typewriter
  effect, and an **About the developer** footer — the bot can also answer
  "who built you?" conversationally with clickable links.

## Why these choices (context for future decisions)
- **React + FastAPI**, not Flutter — chosen because the demo needs to run
  fast in-browser; Flutter would add emulator/APK overhead with no benefit
  for a few-day timeline.
- **Login instead of anonymous device sessions** — a localStorage session_id
  approach was rejected because clearing the browser cache would wipe chat
  history forever. JWT-based login fixes this and enables cross-device.
- **Supabase, not SQLite** — SQLite was rejected because free hosting
  platforms wipe local disk on deploy, deleting all users/history. Supabase
  provides hosted Postgres **and** built-in email/password auth in one free
  service, replacing hand-rolled JWT/bcrypt code.
- **Anthropic Claude as primary model** — chat generation uses direct
  Anthropic Claude API (`claude-3-5-sonnet-20241022`) via `ANTHROPIC_API_KEY` with
  native tool-calling for news, stocks, sports, images, and general knowledge.
  Provides fast responses, reliable multilingual support (Telugu, Hindi, Tamil),
  and strong general knowledge accuracy without free-tier rate limits.
- **Two Supabase clients in `backend/main.py`** — `supabase` is used *only*
  for auth; `db` (service_role) is used *only* for data + storage. This is
  deliberate: `sign_in_with_password` attaches the logged-in user's session
  to the client, so storage/DB calls on the auth client ride the user's JWT
  and fail RLS. `db` never sees a user session, so it bypasses RLS.
- **Bot name: "Ben AI"** — a black-background monogram logo (bold "B" + teal
  accent) in the app header.

## Tech stack (current)
- Backend: FastAPI (Python), Supabase (Postgres + Auth + Storage),
  Anthropic Claude API (direct native tool-calling with `claude-3-5-sonnet-20241022`)
- Frontend: React 19 + Vite (`frontend-app/`), Tailwind **v4**
  (via `@tailwindcss/vite` — **no `tailwind.config.js`**; dark mode is
  `@custom-variant dark (&:where(.dark, .dark *));` in `src/index.css`),
  lucide-react, `react-markdown` + `remark-gfm` + `react-syntax-highlighter`
- Voice input: Browser Web Speech API (free, no backend needed) — decorative
  waveform animation in the input while listening
- External APIs: NewsAPI.org, Alpha Vantage (stocks), ESPN public scoreboard
  API for sports (keyless), and image search via Google Custom Search JSON API
  with a keyless Wikimedia Commons fallback (Google CSE 403s at account level —
  see Known gaps).

## File map

```
ben-ai-chatbot/
├── backend/
│   ├── main.py             FastAPI app: Supabase auth, conversations + chat
│   │                       routes, tool-calling, image upload/validation.
│   │                       Start here. Also: _validate_image(), _generate_title()
│   ├── requirements.txt
│   ├── .env.example        Copy to .env and fill in real API + Supabase keys
│   └── README.md           Supabase setup + run instructions
├── migration.sql           One-time Supabase schema: conversations table +
│                           conversation_id/image_url cols + backfill.
│                           Run in SQL Editor (idempotent).
├── node_tests.mjs          E2E regression suite (13 checks, includes the live
│                           chat + storage + auto-title). Reads Supabase keys
│                           from env (node --env-file=backend/.env).
├── frontend-app/           The LIVE frontend (Vite). Port 5173.
│   ├── src/App.jsx                 Shell: sidebar + chat + input + copy/share
│   ├── src/useChatSession.js       Hook: conversations, messages, send/rename/pin
│   ├── src/ConversationsSidebar.jsx  Chat list, New Chat, pin/rename
│   ├── src/MarkdownMessage.jsx      react-markdown renderer + code highlight
│   ├── src/useAuth.js / useTheme.js / Login.jsx / Greeting.jsx / DeveloperFooter.jsx
│   └── src/index.css               Tailwind v4 + dark variant + markdown styles
└── PROJECT_BRIEF.md        This file
```

## Setup steps
1. `cd backend && pip install -r requirements.txt` (venv already provisioned).
2. Supabase: create a project, turn off "Confirm email" under Authentication →
   Providers → Email (so signup returns a session), and run `migration.sql` in
   the SQL Editor. Create the `chat-images` storage bucket (public) — the
   backend attempts this at startup but silently swallows failure, so verify
   it exists.
3. Copy `backend/.env.example` → `backend/.env`:
   - `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (service_role, not anon) — required
   - `OPENROUTER_API_KEY` (openrouter.ai/keys) — required for chat
   - `NEWS_API_KEY`, `ALPHA_VANTAGE_KEY`, `GOOGLE_CSE_KEY` + `GOOGLE_CSE_ID` —
     required for news/stocks/image results
4. Run backend: `cd backend && ./venv/Scripts/python.exe -m uvicorn main:app
   --port 8000` (note: `--reload` has not reliably picked up edits here —
   restart cleanly instead).
5. Frontend: `cd frontend-app && npm install && npm run dev` (Vite, port 5173;
   `API_BASE` in `src/useAuth.js` points at `http://127.0.0.1:8000`).
6. Verify: with the backend up, `cd ben-ai-chatbot && node --env-file=backend/.env
   node_tests.mjs` should print **13/13 checks passed**.

## Known gaps / what's left to build
- **Image search uses a keyless Wikimedia Commons fallback.** The Google Custom
  Search JSON API 403s at the *account* level ("project does not have access...")
  for this key — a Google console/API-enablement restriction, not a code bug, and
  it affects plain web search too, so it isn't fixable from our side. `search_images`
  tries Google first, then falls back to Wikimedia (respects a descriptive
  User-Agent; retries 6× with backoff against burst throttling). If Google access
  is ever enabled for the key, results switch back automatically.
- **No streaming/typing responses** — replies appear all at once after the
  round trip. Streaming would need SSE + a streaming client.
- **No rate limiting / abuse protection** — fine for a class demo.
- **CORS is wide open (`allow_origins=["*"]`)** — tighten before real deploys.
- **Auth token in localStorage** — XSS exposure; HttpOnly cookies would be safer.
- **Frontend bundle ~1 MB** (react-syntax-highlighter pulls full Prism) —
  code-split or switch to a lighter highlighter if it matters.

## Design language (for consistency if extending the UI)
- Colors: white/stone-50 background, near-black (`#0B0C0E`) for logo/primary
  buttons, off-white (`#F4F3EF`) letterform, one accent — teal (`#4FD1C5`) —
  used sparingly. Rounded-xl corners, soft shadows, Tailwind stone neutrals.
- Avoid cream-and-terracotta or neon-gradient-on-black aesthetics.

## Environment gotchas observed
- This dev machine is **memory-starved** (a ~925 MB Next.js dev server from
  another project + several Chrome processes). The OS has killed the uvicorn
  background process several times with "low on memory" — restart it with the
  command above; don't treat a dead process as a code bug.
- Storage uploads must go through `db.storage` (see "Why these choices") —
  `supabase.storage` fails with 403 RLS after any user logs in.
- The Supabase service key and all API keys live in `backend/.env` —
  **never commit that file**.