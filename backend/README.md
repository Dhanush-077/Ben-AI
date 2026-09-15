# Ben AI Chatbot — Backend Setup

## 1. Install

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Set up Supabase (takes ~5 minutes)

1. Go to supabase.com → sign up (free) → **New Project**.
2. Once created, go to **Project Settings → API**. Copy:
   - **Project URL** → this is `SUPABASE_URL`
   - **service_role key** (NOT the "anon" key — the service_role one) → this is `SUPABASE_SERVICE_KEY`
   - ⚠️ The service_role key is powerful — keep it only in your backend `.env`, never in frontend code.
3. Go to **Authentication → Providers → Email**, and for a friction-free demo,
   turn **OFF** "Confirm email" (otherwise users must click a confirmation
   link before they can log in — fine for a real app, annoying for a quick demo).
4. Go to the **SQL Editor** and run this once to create the messages table:

   ```sql
   create table messages (
     id bigint generated always as identity primary key,
     user_id uuid not null,
     role text not null,
     content text not null,
     created_at timestamptz not null default now()
   );
   ```

## 3. API Keys

Copy `.env.example` → `.env` and fill in:

- **ANTHROPIC_API_KEY** — console.anthropic.com (required)
- **SUPABASE_URL** + **SUPABASE_SERVICE_KEY** — from step 2 (required)
- **NEWS_API_KEY** — newsapi.org (free tier, required for news)
- **ALPHA_VANTAGE_KEY** — alphavantage.co (free tier, required for stocks)
- **GOOGLE_CSE_KEY** + **GOOGLE_CSE_ID** — Google Custom Search JSON API
  (console.cloud.google.com → enable Custom Search API, then
  programmablesearchengine.google.com → create a search engine with
  "Image search" turned ON)

Then load the .env before running:

```python
from dotenv import load_dotenv
load_dotenv()
```

(add this near the top of `main.py`, before the `os.environ.get(...)` lines)

## 4. Sports API

`get_sports_scores` is a placeholder — sign up for SportRadar (has a free trial)
or scrape ESPN's public endpoints, then fill in the function in `main.py`.

## 5. Run

```bash
uvicorn main:app --reload --port 8000
```

Visit `http://127.0.0.1:8000` — should show `{"status": "Chatbot backend is running"}`

## 6. Test signup + chat

```bash
# Sign up (returns an access token)
curl -X POST http://127.0.0.1:8000/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "test1234"}'

# Use the returned token to chat
curl -X POST http://127.0.0.1:8000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{"message": "who built you?"}'
```

## 7. Before you plug in the frontend

Open `main.py` and paste your Google Drive resume link where it says
`[https://drive.google.com/file/d/1SxAgTUVVsXIlN8yxjZhd9VMzvf7uiVSB/view?usp=drive_link]` in the SYSTEM_PROMPT.
