"""
Multi-modal Chatbot Backend
----------------------------
FastAPI backend that powers a chatbot which can:
  - Answer general/coding questions (via official Google Gemini API with native tool-calling)
  - Fetch live news, stock prices, and sports scores (via tool-calling)
  - Search and return relevant images + source links
  - Accept text, voice-transcribed text, and image inputs

Run with:  uvicorn main:app --reload --port 8000
"""

import json
import os
import re
import base64
import uuid
import requests
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load backend/.env before reading os.environ below. Pin it to this file's
# location so it works regardless of which directory uvicorn is started from.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from supabase import create_client, Client

# ---------------------------------------------------------------------------
# CONFIG — put your keys in a .env file or environment variables
# ---------------------------------------------------------------------------
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")  # service_role key — backend only, never expose to frontend
NEWS_API_KEY = os.environ.get("NEWS_API_KEY", "")
ALPHA_VANTAGE_KEY = os.environ.get("ALPHA_VANTAGE_KEY", "")
GOOGLE_CSE_KEY = os.environ.get("GOOGLE_CSE_KEY", "")
GOOGLE_CSE_ID = os.environ.get("GOOGLE_CSE_ID", "")

# Google Gemini API setup (official generativelanguage.googleapis.com endpoint)
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-1.5-flash")
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)   # auth (signup/login/get_user)
db: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)        # data ops — never tainted by login
# Chat client: official Google Gemini API (direct, via generativelanguage.googleapis.com)

# Image uploads go into a public Supabase Storage bucket so the frontend can
# show them straight from its public URL. Ensures the bucket exists once.
IMAGE_BUCKET = "chat-images"
try:
    supabase.storage.create_bucket(IMAGE_BUCKET, {"public": True})
except Exception:
    pass  # bucket already exists

app = FastAPI(title="Multi-Modal Chatbot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this before real deployment
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# DATABASE + AUTH — Supabase handles both.
#
# Auth: Supabase's built-in email/password auth issues its own access tokens
# (JWTs) — we don't hash passwords or create tokens ourselves anymore.
#
# Chat history: stored in a Postgres table called "messages" inside your
# Supabase project, with each thread grouped under a row in the
# "conversations" table (see migration.sql, run it once in the SQL Editor —
# it also backfills existing messages into one "Imported history" chat per
# user). The messages table looks like:
#
#   id, user_id, role, content, conversation_id -> conversations(id),
#   image_url, created_at
#
# We use the service_role key on the backend, which bypasses Row Level
# Security — that's fine here because every query below is manually filtered
# by the authenticated user's id, so users can never see each other's data.
# ---------------------------------------------------------------------------


def save_message(user_id: str, role: str, content: str, conversation_id: int | None = None, image_url: str | None = None):
    db.table("messages").insert({
        "user_id": user_id,
        "role": role,
        "content": content,
        "conversation_id": conversation_id,
        "image_url": image_url,
        "created_at": datetime.utcnow().isoformat(),
    }).execute()


def load_history(conversation_id: int):
    res = (
        db.table("messages")
        .select("role, content, image_url, created_at")
        .eq("conversation_id", conversation_id)
        .order("id")
        .execute()
    )
    return res.data


# ---------------------------------------------------------------------------
# CONVERSATIONS — each chat thread is a row in `conversations`; messages hang
# off it via conversation_id. Run migration.sql in the Supabase SQL Editor to
# create the table/columns (see that file).
# ---------------------------------------------------------------------------
def get_conversation(conversation_id: int, user_id: str):
    """Returns the conversation row iff it belongs to this user, else None."""
    res = (
        db.table("conversations")
        .select("id, title, pinned, created_at")
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def create_conversation(user_id: str, title: str = "New chat"):
    res = db.table("conversations").insert({
        "user_id": user_id,
        "title": title,
        "pinned": False,
        "created_at": datetime.utcnow().isoformat(),
    }).execute()
    return res.data[0]


def list_conversations(user_id: str):
    # Pinned first, then newest first.
    res = (
        db.table("conversations")
        .select("id, title, pinned, created_at")
        .eq("user_id", user_id)
        .order("pinned", desc=True)
        .order("id", desc=True)
        .execute()
    )
    return res.data or []


def update_conversation(conversation_id: int, user_id: str, **fields):
    """Update non-None fields on a conversation owned by user_id. Returns the
    updated row, or None if the conversation isn't owned by this user."""
    if get_conversation(conversation_id, user_id) is None:
        return None
    res = (
        db.table("conversations")
        .update({k: v for k, v in fields.items() if v is not None})
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .execute()
    )
    return (res.data or [None])[0]


def count_conversation_messages(conversation_id: int):
    res = (
        db.table("messages")
        .select("id", count="exact")
        .eq("conversation_id", conversation_id)
        .execute()
    )
    return res.count or 0


def upload_image(user_id: str, filename: str, data: bytes):
    """Upload raw image bytes to the chat-images bucket, return its public URL.

    Uses `db.storage` (never `supabase.storage`): `supabase` is the auth client,
    and its `/login` calls sign_in_with_password(), which attaches a logged-in
    user's session to that client. Storage calls then ride the user's JWT (role
    `authenticated`), which has no INSERT policy on storage.objects -> 403 "new
    row violates row-level security policy". `db` is the dedicated service-role
    client that never gets a user session, so its storage calls bypass RLS.
    Same reason all DB reads/writes already use `db`.
    """
    path = f"{user_id}/{uuid.uuid4().hex}-{os.path.basename(filename) or 'image'}"
    db.storage.from_(IMAGE_BUCKET).upload(path, data)
    return db.storage.from_(IMAGE_BUCKET).get_public_url(path)


# ---------------------------------------------------------------------------
# IMAGE VALIDATION — cheap pre-flight checks so garbage uploads are rejected
# with a friendly 400 before they hit storage or the model, instead of
# surfacing as storage/provider errors (500s) later.
# ---------------------------------------------------------------------------
MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 8 MB cap — also keeps base64 payloads sane


def _validate_image(data: bytes) -> str | None:
    """Return a human-readable error if `data` is not a plausible image.

    Checks the magic bytes for common formats (PNG/JPEG/GIF/WebP) and rejects
    empty or over-sized uploads. None means "looks fine" — this is a heuristic,
    not a full decoder; corrupt files still get caught gracefully by the model
    fallback path in run_chat.
    """
    if not data:
        return "The upload was empty — attach an image and try again."
    if len(data) > MAX_IMAGE_BYTES:
        return "The image is over 8 MB — please upload a smaller one."
    head = data[:16]
    looks_like_image = any(
        (
            head.startswith(b"\x89PNG\r\n\x1a\n"),   # PNG
            head.startswith(b"\xff\xd8\xff"),        # JPEG
            head.startswith(b"GIF8"),                # GIF
            head.startswith(b"RIFF") and head[8:12] == b"WEBP",  # WebP
        )
    )
    if not looks_like_image:
        return "That doesn't look like an image. Please upload a PNG, JPG, GIF, or WebP."
    return None


# ---------------------------------------------------------------------------
# AUTH — signup/login via Supabase, and a dependency that verifies the
# incoming Supabase access token on every protected request.
# ---------------------------------------------------------------------------
security = HTTPBearer()


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(security)):
    try:
        user_response = supabase.auth.get_user(creds.credentials)
        user = user_response.user
        if not user:
            raise ValueError("no user")
        return {"user_id": user.id, "email": user.email}
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


class SignupRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


@app.post("/signup")
async def signup(req: SignupRequest):
    try:
        result = supabase.auth.sign_up({"email": req.email, "password": req.password})
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result.session:
        # Depending on your Supabase project settings, email confirmation may be
        # required before a session is issued. Disable "Confirm email" in
        # Supabase Auth settings for a frictionless demo, or handle this case
        # on the frontend by telling the user to check their inbox.
        raise HTTPException(
            status_code=400,
            detail="Signup succeeded but no session was returned — check if email confirmation is required in your Supabase Auth settings.",
        )
    return {"token": result.session.access_token, "email": req.email}


@app.post("/login")
async def login(req: LoginRequest):
    try:
        result = supabase.auth.sign_in_with_password({"email": req.email, "password": req.password})
    except Exception:
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return {"token": result.session.access_token, "email": req.email}


class OAuthExchangeRequest(BaseModel):
    access_token: str


@app.post("/auth/exchange")
async def oauth_exchange(req: OAuthExchangeRequest):
    """Accept a Supabase access token from a frontend OAuth flow, verify it,
    and return the same {token, email} shape the rest of the frontend expects."""
    try:
        user_response = supabase.auth.get_user(req.access_token)
        user = user_response.user
        if user is None:
            raise HTTPException(status_code=401, detail="Invalid OAuth token")
        return {"token": req.access_token, "email": user.email or ""}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid OAuth token")


# ---------------------------------------------------------------------------
# SYSTEM PROMPT — includes the "who built you" answer
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You are Ben AI, a knowledgeable and capable multi-modal assistant. You can
answer ANY question the user asks — coding, math, science, history, geography, current events,
creative writing, explanations, analysis, advice, translation, and more. You are helpful,
accurate, and thorough. Answer confidently and provide clear, well-structured responses.

You support text, voice, and image input. You have tools available to look up live data
when needed — use them when appropriate, but you are also capable of answering most
questions from your own knowledge.

LANGUAGE MATCHING: Always respond in the same language the user writes in. If the user
writes in Telugu, reply in Telugu. If they write in Hindi, reply in Hindi. If they mix
languages (e.g. Telugu and English together), mirror that same mixed style in your reply
rather than switching to pure English. Only use English when the user writes in English.

MUST-USE TOOLS — you are REQUIRED to use tools for these categories. Do NOT answer
from your own knowledge for these topics:
- POLITICAL QUESTIONS: Any question about politicians, elections, government officials,
  political parties, ministers, chief ministers, prime ministers, presidents, governors,
  cabinet members, political events, or government policies — ALWAYS use get_news (for
  very recent political events, last few days) or search_general_knowledge (for
  established political facts like "who is the current CM of Andhra Pradesh"). NEVER
  guess political information from your training data — it is almost certainly outdated.
- CURRENT EVENTS: Any question about what's happening now, today, this week — use get_news.
- SPORTS SCORES: Use get_sports_scores.
- STOCK PRICES: Use get_stock_price.
- IMAGES: Use search_images.

OTHER TOOLS (use when helpful):
- search_general_knowledge: For factual/historical questions where accuracy matters
  (geography, science, history, sports history, etc.). You may also answer from your
  knowledge if you are very confident, but prefer the tool when available.

RULES FOR TOOL-BASED ANSWERS: When you DO use a tool, base your answer ONLY on the
tool's data. Do NOT add facts from your own knowledge alongside tool results. If a
tool returns nothing useful or an error, say so honestly — do NOT guess or fill in
with your own knowledge.

Be conversational, helpful, and thorough. Answer to the best of your ability on every
topic. If you genuinely don't know something, say so honestly rather than making
something up.

Always format code using markdown triple-backtick code fences with the language
specified (for example ```javascript, ```java, ```python). Use headings, bullet
lists, and other markdown formatting freely so your replies render cleanly.

Always give complete, thorough answers — don't cut explanations short.
When you provide code, always explain what the code does, how it works
line-by-line or in logical sections, and how to run it — don't just paste
code with no explanation.

If the user asks — in any language or phrasing — who created you, built you, developed you,
or made you, or asks about your developer, creator, or maker (e.g. "who built you",
"who developed you", "who made you", "who is your developer", "నిన్ను ఎవరు తయారు చేశారు",
"तुम्हें किसने बनाया", or any equivalent in any language), answer with a short 1-2 sentence
intro, then a bullet list of 2-3 standout projects, then the links below as markdown links
(use these exact URLs and label text):
- Name: Janakisetty Dhanush Babu — B.Tech CSE (3rd Year), PBR Visvodaya Institute of
  Technology and Science, Kavali, Nellore, A.P.
- Standout projects: a Virtual Keyboard & Air Mouse System (Python, OpenCV, MediaPipe),
  a Tropical Cloud Cluster Detection model, and a Gesture Control Presenter.
- Format the links exactly like this, each on its own line:
  [GitHub]()
  [LinkedIn](https://linkedin.com/in/dhanushbabujanakisetty)
  [View Resume](https://drive.google.com/file/d/1SxAgTUVVsXIlN8yxjZhd9VMzvf7uiVSB/view?usp=sharing)

IMPORTANT: When answering the developer question, reply in the SAME LANGUAGE the user asked in.
Do not default to English if the user asked in another language.
"""

# ---------------------------------------------------------------------------
# TOOL DEFINITIONS — Claude decides when to call these
# ---------------------------------------------------------------------------
TOOLS = [
    {
        "name": "get_news",
        "description": "Get the latest news headlines for a topic or general current affairs.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Topic to search news for, e.g. 'AI', 'elections', 'cricket'"}
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_stock_price",
        "description": "Get the current/latest stock price for a given ticker symbol.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "Stock ticker symbol, e.g. 'AAPL', 'TSLA', 'TCS.BSE'"}
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "get_sports_scores",
        "description": "Get recent or live sports scores/results for a team or league.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Team, player, or league, e.g. 'India vs Australia', 'IPL', 'Premier League'"}
            },
            "required": ["query"],
        },
    },
    {
        "name": "search_images",
        "description": "Search the web for relevant images about a topic, to show alongside the answer.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What to find images of"}
            },
            "required": ["query"],
        },
    },
    {
        "name": "search_general_knowledge",
        "description": "Look up factual, historical, trivia, or general knowledge questions via Wikipedia. Use this for questions about history, science, geography, sports history, current officeholders, or any factual question where you need an authoritative source rather than relying on your own memory.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The factual question or topic to look up, e.g. 'who won 2011 cricket world cup', 'capital of France', 'current president of India'"}
            },
            "required": ["query"],
        },
    },
]


# ---------------------------------------------------------------------------
# TOOL IMPLEMENTATIONS — actual API calls
# ---------------------------------------------------------------------------
def get_news(query: str):
    if not NEWS_API_KEY:
        return {"error": "NEWS_API_KEY not configured"}
    url = "https://newsapi.org/v2/everything"
    # language=en so political/current-affairs queries reliably hit English coverage;
    # sortBy publishedAt always returns the freshest articles for the query.
    params = {"q": query, "sortBy": "publishedAt", "pageSize": 5, "language": "en", "apiKey": NEWS_API_KEY}
    try:
        r = requests.get(url, params=params, timeout=10)
        data = r.json()
    except Exception:
        return {"articles": [], "note": "News lookup failed (network/timeout) — no data available. Do not guess."}
    if data.get("status") != "ok":
        return {"articles": [], "note": f"News API error: {data.get('message', 'unknown')}. Do not guess."}
    articles = data.get("articles", [])[:5]
    return {
        "source": "NewsAPI — recent articles (last few days)",
        "articles": [
            {
                "title": a["title"],
                "source": a["source"]["name"],
                "url": a["url"],
                "image": a.get("urlToImage"),
                "published": a.get("publishedAt"),
            }
            for a in articles
        ],
        "note": "No recent articles found for this query — the topic may not have been in the news recently, or the query terms need adjusting.",
    } if articles else {
        "source": "NewsAPI — recent articles (last few days)",
        "articles": [],
        "note": "No recent articles found for this query — the topic may not have been in the news recently, or the query terms need adjusting. Do not guess.",
    }


def get_stock_price(symbol: str):
    if not ALPHA_VANTAGE_KEY:
        return {"error": "ALPHA_VANTAGE_KEY not configured"}
    url = "https://www.alphavantage.co/query"
    params = {"function": "GLOBAL_QUOTE", "symbol": symbol, "apikey": ALPHA_VANTAGE_KEY}
    r = requests.get(url, params=params, timeout=10)
    quote = r.json().get("Global Quote", {})
    return {
        "symbol": symbol,
        "price": quote.get("05. price"),
        "change": quote.get("09. change"),
        "change_percent": quote.get("10. change percent"),
    }


# ---------------------------------------------------------------------------
# SPORTS SCORES — free ESPN public scoreboard API (no API key required)
#
# ESPN exposes //site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard
# as public JSON. It's not an officially-documented API, so we stay resilient:
#   - try today's slate, then yesterday's, for "recent or live" results
#   - tolerate non-200 / throttle (ESPN rate-limits bursts) by skipping quietly
#   - short result cache so the CLI loop / repeat questions don't re-hit it
# ---------------------------------------------------------------------------
ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard"
ESPN_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"}

# Words that should not be treated as team names when filtering events.
_SPORTS_SKIP = {
    "score", "scores", "scored", "match", "game", "games", "today", "yesterday",
    "live", "result", "results", "latest", "what", "the", "of", "and", "for",
    "vs", "v", "at", "who", "are", "is", "cricket", "soccer", "football",
    "basketball", "baseball", "hockey", "league", "premier", "epl", "ipl",
    "nba", "nfl", "mlb", "nhl", "wnba", "series", "season", "against", "news",
}

_score_cache = {}  # key -> (timestamp, payload)


def _rank_sports_candidates(query: str):
    """Map a user query to an ordered list of (sport, league, label) to try."""
    q = query.lower()
    picks = []

    def add(*candidate):
        if candidate[:2] not in [p[:2] for p in picks]:
            picks.append(candidate)

    def has(words):
        return any(w in q for w in words)

    # Concrete league names first — these are the highest-confidence guesses.
    if has(["indian premier league", "ipl"]):
        add("cricket", "ipl", "IPL")
    if has(["premier league", "epl", "english premier"]):
        add("soccer", "eng.1", "Premier League")
    if has(["la liga"]):
        add("soccer", "esp.1", "La Liga")
    if has(["serie a"]):
        add("soccer", "ita.1", "Serie A")
    if has(["bundesliga"]):
        add("soccer", "ger.1", "Bundesliga")
    if has(["ligue 1"]):
        add("soccer", "fra.1", "Ligue 1")
    if has(["mls"]):
        add("soccer", "usa.1", "MLS")
    if has(["champions league", "ucl"]):
        add("soccer", "uefa.champions", "Champions League")
    if has(["world cup", "wc"]):
        add("soccer", "fifa.world", "World Cup")
    if has(["wnba"]):
        add("basketball", "wnba", "WNBA")
    if has(["nba"]):
        add("basketball", "nba", "NBA")
    if has(["nfl"]):
        add("americanfootball", "nfl", "NFL")
    if has(["mlb", "baseball"]):
        add("baseball", "mlb", "MLB")
    if has(["nhl", "hockey"]):
        add("hockey", "nhl", "NHL")

    # Sport-category words → try that sport's most popular league(s).
    cricket_words = ["cricket", "india", "australia", "england", "pakistan",
                     "sri lanka", "new zealand", "south africa", "west indies",
                     "bangladesh", "ashes", "t20", "odi", "test match"]
    if has(cricket_words):
        add("cricket", "icc", "International cricket")
        add("cricket", "ipl", "IPL")
        if has(["test", "ashes"]):
            add("cricket", "test", "Test cricket")
        if has(["odi"]):
            add("cricket", "odi", "ODI cricket")
    if has(["soccer", "football"]):
        add("soccer", "eng.1", "Premier League")
    if has(["basketball"]):
        add("basketball", "nba", "NBA")
    if has(["american football"]):
        add("americanfootball", "nfl", "NFL")

    # "Any sports" fallback — pick leagues usually in/around season.
    if not picks:
        add("soccer", "eng.1", "Premier League")
        add("americanfootball", "nfl", "NFL")
        add("baseball", "mlb", "MLB")

    return picks[:4]  # cap hits to ESPN to avoid throttling


def _fetch_espn_events(sport, league, date_str):
    """Fetch one league's scoreboard for one day; returns events or [] on failure.

    ESPN's public endpoint is unauthenticated and occasionally throttles bursts
    (sporadic 403s), so retry a couple of times with backoff before giving up.
    """
    cache_key = (sport, league, date_str)
    cached = _score_cache.get(cache_key)
    if cached and time.time() - cached[0] < 300:  # 5-min TTL limits ESPN hits
        return cached[1]
    events = []
    for attempt in range(3):
        try:
            r = requests.get(
                ESPN_SCOREBOARD_URL.format(sport=sport, league=league),
                params={"dates": date_str}, headers=ESPN_HEADERS, timeout=12,
            )
            if r.status_code == 200:
                events = r.json().get("events", [])
                break
        except Exception:
            pass
        time.sleep(2)  # back off before the next try
    _score_cache[cache_key] = (time.time(), events)
    return events


def _sports_team_tokens(query: str):
    return [t for t in re.split(r"[^A-Za-z0-9]+", query) if len(t) >= 3 and t.lower() not in _SPORTS_SKIP]


def _event_matches_teams(event, tokens):
    """True if any query token appears in an event's team name/abbreviation."""
    if not tokens:
        return True
    names = []
    for comp in event.get("competitions", []):
        for c in comp.get("competitors", []):
            t = c.get("team", {})
            names += [t.get("displayName", ""), t.get("shortDisplayName", ""),
                      t.get("abbreviation", ""), t.get("alternateName", "") or ""]
    joined = " ".join(names).lower()
    return any(tok in joined for tok in tokens)


def _score_entry(event, league_label):
    comp = (event.get("competitions") or [{}])[0]
    status = comp.get("status") or {}
    stype = status.get("type") or {}
    state = stype.get("description") or (event.get("status", {}).get("type", {}).get("description") or "Scheduled")
    detail = status.get("shortDetail") or stype.get("shortDetail") or state
    sides = []
    for c in comp.get("competitors", []):
        tm = c.get("team", {})
        name = tm.get("shortDisplayName") or tm.get("displayName", "?")
        score = (c.get("score") or "").strip()
        # Scheduled games have an empty/placeholder score — omit it, show matchup only.
        if score and score not in ("-", "–"):
            sides.append(f"{name} {score}")
        else:
            sides.append(name)
    summary = " vs ".join(sides) if len(sides) >= 2 else ", ".join(sides)
    return {
        "league": league_label,
        "event": event.get("name"),
        "status": state,
        "detail": detail,
        "score": summary,
    }


def get_sports_scores(query: str):
    """Get recent or live sports scores for a team/league via ESPN (no key)."""
    candidates = _rank_sports_candidates(query)
    tokens = _sports_team_tokens(query)
    today = datetime.now().strftime("%Y%m%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")

    matched, all_events, leagues_label = [], [], []
    for sport, league, label in candidates:
        leagues_label.append(label)
        for date_str in (today, yesterday):
            events = _fetch_espn_events(sport, league, date_str)
            if not events:
                continue
            for ev in events:
                all_events.append((ev, label))  # one date's slate is enough
                if _event_matches_teams(ev, tokens):
                    matched.append(_score_entry(ev, label))
            break
        if len(matched) >= 6:
            break

    if not all_events:
        what = ", ".join(dict.fromkeys(leagues_label))
        return {"note": f"Couldn't load scores for “{query}” right now — no recent games found from: {what}. Try naming a league or team (e.g. 'IPL', 'Premier League', 'NBA')."}

    games = matched[:6] if matched else [_score_entry(ev, label) for ev, label in all_events[:6]]
    if matched or not tokens:
        return {"games": games}
    # Query named teams but nothing matched — report the league slate instead.
    return {
        "note": f"I couldn't find games for the teams in “{query}” among the leagues I track, so here are the latest scores instead:",
        "games": games,
    }


# Keyless fallback image source (Wikimedia Commons public API — no key).
# Used when Google Custom Search isn't configured/permissioned for this
# project (e.g. a 403 "This project does not have the access to Custom Search
# JSON API"), so image search + the image strip still work for the demo.
WIKIMEDIA_API_URL = "https://commons.wikimedia.org/w/api.php"

# Google access is an account-level setting and deterministic: once the CSE
# call 403s, it will for every query. Cache that so later image searches skip
# the doomed Google request entirely (fewer requests → Wikimedia fallback is
# less likely to hit its burst throttle).
_google_cse_unavailable = False


def _search_images_wikimedia(query: str):
    """Image search via Wikimedia Commons: find File: pages, then their
    thumbnail URL + describing page. Returns [] on any failure.

    Constraints that matter in practice:
    - Wikimedia enforces a descriptive User-Agent (403 without one), so we send
      one that identifies the app rather than the bare python-requests default.
    - Wikimedia throttles bursts from one client/IP, so each API call retries
      with a short backoff before giving up.
    - Titles can contain HTML (links inside ImageDescription) — strip tags.
    """
    wm_headers = {"User-Agent": "BenAI/1.0 (educational chatbot demo; https://github.com/) via requests"}
    # Wikimedia throttles this IP in 1–3-minute bursts; 6 attempts with growing
    # backoff (~17s worst case) ride out most of them.
    for attempt in range(6):
        try:
            s = requests.get(WIKIMEDIA_API_URL, params={
                "action": "query", "list": "search", "srsearch": query,
                "srnamespace": "6", "srlimit": "6", "format": "json",
            }, headers=wm_headers, timeout=10)
            if s.status_code != 200:
                time.sleep(0.8 * (attempt + 1))
                continue
            titles = [r["title"] for r in s.json().get("query", {}).get("search", []) if r.get("title")]
            if not titles:
                return []
            ii = requests.get(WIKIMEDIA_API_URL, params={
                "action": "query", "titles": "|".join(titles[:4]),
                "prop": "imageinfo", "iiprop": "url|exturl|extmetadata",
                "iiurlwidth": "480", "format": "json",
            }, headers=wm_headers, timeout=10)
            if ii.status_code != 200:
                time.sleep(0.8 * (attempt + 1))
                continue
            out = []
            for page in ii.json().get("query", {}).get("pages", {}).values():
                info = (page.get("imageinfo") or [{}])[0]
                url = info.get("thumburl") or info.get("url")
                if not url:
                    continue
                desc = (info.get("extmetadata") or {}).get("ImageDescription") or {}
                value = desc.get("value") if isinstance(desc, dict) else ""
                title = re.sub(r"<[^>]+>", "", value or "") or str(page.get("title", "Image"))
                title = title.strip()[:180]
                out.append({"title": title, "image_url": url, "context_url": info.get("exturl") or url})
            return out
        except Exception:
            time.sleep(0.8 * (attempt + 1))
    return []


def search_images(query: str):
    global _google_cse_unavailable
    if not GOOGLE_CSE_KEY or not GOOGLE_CSE_ID:
        return {"error": "GOOGLE_CSE_KEY / GOOGLE_CSE_ID not configured"}
    if not _google_cse_unavailable:
        url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "q": query,
            "cx": GOOGLE_CSE_ID,
            "key": GOOGLE_CSE_KEY,
            "searchType": "image",
            "num": 4,
        }
        r = requests.get(url, params=params, timeout=10)
        payload = r.json()
        google_err = payload.get("error")
        items = payload.get("items", []) if not google_err else []
        if items:
            return [{"title": i["title"], "image_url": i["link"], "context_url": i.get("image", {}).get("contextLink")} for i in items]
        if google_err:
            _google_cse_unavailable = True  # deterministic account-level restriction
    else:
        google_err = None
    # Google unavailable (403/no access) or returned no images → try Wikimedia.
    wm = _search_images_wikimedia(query)
    if wm:
        print(f"[search_images] Google Custom Search unavailable ({google_err or 'no results'}); using Wikimedia fallback", flush=True)
        return wm
    if google_err:
        reason = (google_err.get("errors") or [{}])[0].get("reason", "unknown")
        return {"error": f"Google Custom Search HTTP {r.status_code} ({reason}) and Wikimedia fallback empty for “{query[:80]}”"}
    return {"error": f"No image results from Google or Wikimedia for “{query[:80]}”"}


# ---------------------------------------------------------------------------
# GENERAL KNOWLEDGE — Wikipedia API (keyless)
#
# Used for historical facts, trivia, geography, science, "who is the current X"
# when the news tool isn't appropriate. Returns the article summary/extract so
# the model can quote facts from an authoritative source.
# ---------------------------------------------------------------------------
_WIKI_SEARCH_URL = "https://en.wikipedia.org/w/api.php"
_WIKI_SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
_WIKI_HEADERS = {"User-Agent": "BenAI-Chatbot/1.0 (Educational project; contact: janakisettydhanushbabu333@gmail.com)"}


def search_general_knowledge(query: str):
    """Look up a factual/trivia/historical question via Wikipedia.

    Returns a list of up to 2 result objects, each with title, extract, and url.
    The model should quote facts from these extracts rather than its own memory.
    """
    results = []
    try:
        # Step 1: search Wikipedia for matching articles.
        search_params = {
            "action": "query",
            "list": "search",
            "srsearch": query,
            "format": "json",
            "srlimit": 3,
        }
        sr = requests.get(_WIKI_SEARCH_URL, params=search_params, headers=_WIKI_HEADERS, timeout=10)
        sr.raise_for_status()
        search_hits = sr.json().get("query", {}).get("search", [])
        if not search_hits:
            return {"results": [], "note": "No Wikipedia articles found for this query."}

        # Step 2: get the extract/summary for the top 2 results.
        for hit in search_hits[:2]:
            title = hit.get("title", "")
            if not title:
                continue
            try:
                summary_url = _WIKI_SUMMARY_URL.format(title=title.replace(" ", "_"))
                summary_resp = requests.get(summary_url, headers=_WIKI_HEADERS, timeout=10)
                if summary_resp.status_code != 200:
                    continue
                summary_data = summary_resp.json()
                extract = summary_data.get("extract", "")
                page_url = summary_data.get("content_urls", {}).get("desktop", {}).get("page", "")
                if extract:
                    results.append({
                        "title": title,
                        "extract": extract[:2000],  # cap length for token economy
                        "url": page_url,
                    })
            except Exception:
                continue

        if not results:
            return {"results": [], "note": "Wikipedia articles found but could not load their content."}
    except Exception as e:
        return {"results": [], "note": f"Wikipedia lookup failed: {str(e)[:120]}"}

    return {"results": results}


TOOL_FUNCTIONS = {
    "get_news": get_news,
    "get_stock_price": get_stock_price,
    "get_sports_scores": get_sports_scores,
    "search_images": search_images,
    "search_general_knowledge": search_general_knowledge,
}




def _generate_title(user_message: str) -> str:
    """
    Generate a short title (2-6 words) from the first meaningful user message.
    Ignores greetings like "hi", "hello", "bro".
    Examples:
    * "Write a Java palindrome program" → "Java Palindrome Program"
    * "Explain SQL INNER JOIN" → "SQL INNER JOIN"
    * "Build a resume" → "Resume Builder"
    """
    # Normalize message
    msg = str(user_message).lower().strip()
    # Remove punctuation
    msg = msg.replace('?', '').replace('!', '').replace('.', '').replace(',', '')
    # Collapse multiple spaces
    while '  ' in msg:
        msg = msg.replace('  ', ' ')

    # Check for greetings to ignore
    greetings = {'hi', 'hello', 'hey', 'bro', 'yo', 'sup', 'hiya', 'howdy'}
    if msg in greetings:
        return "New chat"

    # Tokenize
    tokens = msg.split()

    # Stop words to filter out
    stop_words = {
        'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
        'that', 'this', 'these', 'those', 'it', 'its', 'and', 'or', 'but',
        'not', 'so', 'then', 'than', 'too', 'very', 'can', 'will', 'just',
        'have', 'has', 'had', 'do', 'does', 'did', 'would', 'should', 'could',
        'may', 'might', 'must', 'shall'
    }

    # Filter out stop words
    meaningful_tokens = [t for t in tokens if t not in stop_words and len(t) > 1]

    # If nothing meaningful left, fall back to "New chat"
    if not meaningful_tokens:
        return "New chat"

    # Title-case each token (capitalize first letter)
    titlecased = [token.capitalize() for token in meaningful_tokens]

    # Take first 2-6 tokens (aim for meaningful title)
    # If we have 2-6 tokens, use them all
    # If we have more than 6, take first 6
    # If we have exactly 1 token, we'll use it but the requirement is 2-6 words
    # However, examples show single-word concepts like "Resume Builder" (2 words)
    # Let's aim for 2-6, but if we only have 1 meaningful token, we'll use it anyway
    selected = titlecased[:6]  # Take up to 6

    # If we only got 1 token, that's still better than "New chat"
    # But try to get at least 2 if possible by including some stop words contextually?
    # For simplicity, we'll use what we have
    if len(selected) < 2 and len(titlecased) >= 2:
        # If we filtered too much, take first 2 original tokens and title-case them
        selected = [tokens[0].capitalize(), tokens[1].capitalize()] if len(tokens) >= 2 else [tokens[0].capitalize()]

    return ' '.join(selected)

import re as _re

_SELF_IDENTITY_EN = (
    "I'm Ben AI, an AI-powered assistant built by Janakisetty Dhanush Babu. "
    "I help with coding, AI, career guidance, projects, and everyday questions.\n\n"
    "![Developer Photo](/developer-photo.jpeg)\n\n"
    "I'm **Janakisetty Dhanush Babu** — B.Tech CSE (3rd Year), PBR Visvodaya Institute of Technology and Science, Kavali, Nellore, A.P. Passionate about AI, computer vision, and full-stack development.\n\n"
    "**Contact:** janakisettydhanushbabu333@gmail.com | +91-9059672119\n\n"
    "**Skills:** Python, Java, HTML, CSS, MySQL, Machine Learning, OpenCV, MediaPipe, TensorFlow, Flutter, Full-stack development.\n\n"
    "**Projects:** Virtual Keyboard & Air Mouse System · Tropical Cloud Cluster Detection · Gesture Control Presenter\n\n"
    "**Connect:** [LinkedIn](https://linkedin.com/in/dhanushbabujanakisetty) · [View Resume](https://drive.google.com/file/d/1SxAgTUVVsXIlN8yxjZhd9VMzvf7uiVSB/view?usp=sharing)"
)

_SELF_IDENTITY_TE = (
    "నేను Ben AI, Janakisetty Dhanush Babu చేత built AI assistant. Coding, AI, career guidance, projects తో help చేస్తyorum.\n\n"
    "![Developer Photo](/developer-photo.jpeg)\n\n"
    "**Contact:** janakisettydhanushbabu333@gmail.com | +91-9059672119\n\n"
    "**Skills / Projects / Connect:** same profile — see English above."
)

_SELF_IDENTITY_HI = (
    "मैं Ben AI हूँ — Janakisetty Dhanush Babu द्वारा बनाया गया AI assistant. Coding, AI, career, projects में मदद करता हूँ।\n\n"
    "![Developer Photo](/developer-photo.jpeg)\n\n"
    "**Contact:** janakisettydhanushbabu333@gmail.com | +91-9059672119\n\n"
    "**Skills / Projects / Connect:** same profile — see English above."
)

_PRODUCT_IDENTITY_EN = (
    "Ben AI is an AI-powered assistant created by Janakisetty Dhanush Babu. "
    "It helps with programming, AI, projects, career guidance, and general "
    "conversations using Gemini while maintaining its own Ben AI identity.\n\n"
    "**Founder:** Janakisetty Dhanush Babu\n"
    "**Skills:** Python, Java, HTML, CSS, MySQL, ML, OpenCV, MediaPipe, TensorFlow, Flutter, Full-stack\n"
    "**Featured Projects:** Virtual Keyboard & Air Mouse System · Tropical Cloud Cluster Detection · Gesture Control Presenter\n"
    "\n"
    "**LinkedIn:** https://linkedin.com/in/dhanushbabujanakisetty\n"
    "**Resume:** https://drive.google.com/file/d/1SxAgTUVVsXIlN8yxjZhd9VMzvf7uiVSB/view?usp=sharing"
)

_DEV_NAME_PATTERN = _re.compile(
    r'(who\s+(built|made|created|developed)\s+(you|ben\s*ai)|'
    r'founder\s+of\s+ben\s*ai|who\s+is\s+ben\s*ai|'
    r'janakisetty\s+dhanush\s+babu|dhanush\s+babu\s+janakisetty)',
    _re.IGNORECASE
)

_DEV_RESPONSE_EN = (
    "![Developer Photo](/developer-photo.jpeg)\n\n"
    "I'm **Janakisetty Dhanush Babu**, a B.Tech CSE (3rd Year) student at "
    "PBR Visvodaya Institute of Technology and Science, Kavali, Nellore, "
    "A.P. I'm passionate about AI, computer vision, and full-stack "
    "development — I built Ben AI as my mini-project.\n\n"
    "**Contact:**\n"
    "📧 janakisettydhanushbabu333@gmail.com\n"
    "📱 +91-9059672119\n\n"
    "**Projects I've built:**\n"
    "- Virtual Keyboard & Air Mouse System — touchless computer control "
    "using Python, OpenCV, and MediaPipe\n"
    "- Tropical Cloud Cluster Detection — a deep learning model that "
    "identifies tropical cloud clusters from satellite imagery\n"
    "- Gesture Control Presenter — controls Google Slides using hand "
    "gestures via computer vision\n\n"
    "**Connect with me:**\n"
    "[LinkedIn](https://linkedin.com/in/dhanushbabujanakisetty) · "
    "[View Resume](https://drive.google.com/file/d/1SxAgTUVVsXIlN8yxjZhd9VMzvf7uiVSB/view?usp=sharing)"
)

_DEV_RESPONSE_TE = (
    "![Developer Photo](/developer-photo.jpeg)\n\n"
    "నేను **జానকisetty ధनush Babु**, PBR Visvodaya Institute of Technology and Science, Kavali, Nellore, A.P. లో B.Tech CSE 3వ సంవత్సరం ఎ student. AI, computer vision, full-stack development — Ben AI ని నా mini-project గానే తయaru chedi.\n\n"
    "**Contact:**\n"
    "📧 janakisettydhanushbabu333@gmail.com\n"
    "📱 +91-9059672119\n\n"
    "**Projects:**\n"
    "- Virtual Keyboard & Air Mouse System\n"
    "- Tropical Cloud Cluster Detection\n"
    "- Gesture Control Presenter\n\n"
    "**Connect:**\n"
    "[LinkedIn](https://linkedin.com/in/dhanushbabujanakisetty) · [Resume](https://drive.google.com/file/d/1SxAgTUVVsXIlN8yxjZhd9VMzvf7uiVSB/view?usp=sharing)"
)

_DEV_RESPONSE_HI = (
    "![Developer Photo](/developer-photo.jpeg)\n\n"
    "मैं **Janakisetty Dhanush Babu** हूँ, B.Tech CSE 3rd Year, PBR Visvodaya Institute, Kavali, Nellore. AI, computer vision, full-stack — Ben AI मेरा mini-project.\n\n"
    "**Contact:**\n"
    "📧 janakisettydhanushbabu333@gmail.com\n"
    "📱 +91-9059672119\n\n"
    "**Projects:**\n"
    "- Virtual Keyboard & Air Mouse\n"
    "- Tropical Cloud Cluster Detection\n"
    "- Gesture Control Presenter\n\n"
    "**Connect:**\n"
    "[LinkedIn](https://linkedin.com/in/dhanushbabujanakisetty) · [Resume](https://drive.google.com/file/d/1SxAgTUVVsXIlN8yxjZhd9VMzvf7uiVSB/view?usp=sharing)"
)

def _normalize_message(message: str) -> str:
    msg = str(message).lower()
    msg = msg.replace('?', '').replace('!', '').replace('.', '').replace(',', '').replace("'", '').replace('"', '')
    msg = msg.replace('  ', ' ').strip()
    return msg

def _detect_self_identity(message: str):
    if not message:
        return None
    msg_norm = _normalize_message(message)
    exact_self = [
        'what is your name', 'whats your name', 'what is ur name', 'what is u r name', 'whats ur name', 'whats u r name',
        'who are you', 'what are you',
        'who built you', 'who built u', 'who created you', 'who created u',
        'who developed you', 'who developed u', 'who dveloped you', 'who dveloped u',
        'who made you', 'who made u', 'who owns you', 'who is your developer',
    ]
    if msg_norm in exact_self:
        msg = str(message)
        if any('ఀ' <= ch <= '౿' for ch in msg):
            return _SELF_IDENTITY_TE
        if any('ऀ' <= ch <= 'ॿ' for ch in msg):
            return _SELF_IDENTITY_HI
        return _SELF_IDENTITY_EN
    # Telugu / Hindi script detection on original (before normalization stripped script-sensitive chars too aggressively)
    msg_raw = str(message)
    # Telugu: contains Telugu script characters
    if any('అ' <= ch <= 'హ' for ch in msg_raw):
        return _SELF_IDENTITY_TE
    # Hindi: contains Devanagari script characters
    if any('अ' <= ch <= 'ह' for ch in msg_raw):
        return _SELF_IDENTITY_HI
    # Fallback regex
    msg_low = str(message).lower()
    self_patterns = [
        r'who\s+(are|is)\s+you', r'what\s+(is\s+your|are\s+your)\s+name',
        r'whats\s+your\s+name', r'what\s+are\s+you',
        r'who\s+built\s+you', r'who\s+created\s+you', r'who\s+developed\s+you',
        r'who\s+made\s+you', r'who\s+owns\s+you', r'who\s+is\s+your\s+developer',
    ]
    for p in self_patterns:
        if _re.search(p, msg_low, _re.IGNORECASE):
            if any('అ' <= ch <= 'హ' for ch in msg_raw):
                return _SELF_IDENTITY_TE
            if any('अ' <= ch <= 'ह' for ch in msg_raw):
                return _SELF_IDENTITY_HI
            return _SELF_IDENTITY_EN
    # Fuzzy fallback: message contains "who" + ("you" or "u") + developer keyword with common typos
    msg_raw_low = str(message).lower()
    if 'who' in msg_raw_low and ('you' in msg_raw_low or msg_raw_low.endswith(' u') or ' u ' in msg_raw_low or msg_raw_low == 'who build u' or msg_raw_low == 'who build u?'):
        dev_keywords = ["build", "built", "create", "created", "develop", "dvelop", "dveloped", "developd", "made"]
        if any(k in msg_raw_low for k in dev_keywords) or msg_raw_low in ('who build u', 'who build u?'):
            msg = str(message)
            if any('ఀ' <= ch <= '౿' for ch in msg):
                return _SELF_IDENTITY_TE
            if any('अ' <= ch <= 'ह' for ch in msg):
                return _SELF_IDENTITY_HI
            return _SELF_IDENTITY_EN
    return None
def _detect_product_identity(message: str):
    if not message:
        return None
    msg_norm = _normalize_message(message)
    exact_product = [
        'what is ben ai', 'who is ben ai',
        'tell me about ben ai', 'explain ben ai',
    ]
    if msg_norm in exact_product:
        return _PRODUCT_IDENTITY_EN
    msg_low = str(message).lower()
    product_patterns = [
        r'what\s+is\s+ben\s+ai', r'who\s+is\s+ben\s+ai',
        r'tell\s+me\s+about\s+ben\s+ai', r'explain\s+ben\s+ai',
        r'what\s+is\s+this\s+assistant',
    ]
    for p in product_patterns:
        if _re.search(p, msg_low, _re.IGNORECASE):
            return _PRODUCT_IDENTITY_EN
    return None

def _detect_dev_question(message: str):
    if not message:
        return None
    if _DEV_NAME_PATTERN.search(message):
        if any('ఀ' <= ch <= '౿' for ch in message):
            return _DEV_RESPONSE_TE
        if any('ऀ' <= ch <= 'ॿ' for ch in message):
            return _DEV_RESPONSE_HI
        return _DEV_RESPONSE_EN
    return None

# Fallback + backoff replacement for run_chat
def run_chat(user_message, image_base64=None, image_media_type="image/jpeg", conversation_id=None):
    # FIRST: identity detection in priority order (before history / model)
    # 1. Self Identity
    self_reply = _detect_self_identity(user_message)
    if self_reply is not None:
        return (self_reply, [])
    # 2. Ben AI Product Identity
    product_reply = _detect_product_identity(user_message)
    if product_reply is not None:
        return (product_reply, [])
    # 3. Founder Profile (existing dev detection)
    dev_reply = _detect_dev_question(user_message)
    if dev_reply is not None:
        return (dev_reply, [])
    # Block politician hallucination: any mention of full name
    msg_text_low = str(user_message or '').lower()
    if 'janakisetty dhanush babu' in msg_text_low:
        return (_DEV_RESPONSE_EN, [])
    # Old regex backup (not needed with new pattern above but kept for compatibility)
    dev = __import__('re').compile(r'who.*(built|created|developer|made)', re.IGNORECASE).search(str(user_message) or '')
    if dev:
        # Match input language; default English.
        msg_text = str(user_message or '')
        lang_tele = any(x in msg_text for x in ['నinnu', 'ఎవరు', 'న created'])
        lang_hind = any(x in msg_text for x in ['तुम्हें', 'किसने', 'बनाया'])
        if lang_tele:
            return ("![Developer Photo](frontend-app/src/assets/developer-photo.jpeg)\n\nనన్నu Janakisetty Dhanush Babu — B.Tech CSE (3rd Year), PBR Visvodaya Institute of Technology & Science, Kavali, Nellore. AI, computer vision, full-stack development pasión.\n\nContact: janakisettydhanushbabu333@gmail.com | +91-9012345678\n\nSkills: Python, Java, HTML, CSS, MySQL, Machine Learning, OpenCV, MediaPipe, TensorFlow, Flutter, Full-stack.\n\nProjects:\n- Virtual Keyboard & Air Mouse System\n- Tropical Cloud Cluster Detection\n- Gesture Control Presenter\n\nYou can connect with him:\n[GitHub]() [LinkedIn](https://linkedin.com/in/dhanushbabujanakisetty) [Resume](https://drive.google.com/file/d/1SxAgTUVVsXIlN8yxjZhd9VMzvf7uiVSB/view?usp=sharing)", [])
        if lang_hind:
            return ("![Developer Photo](frontend-app/src/assets/developer-photo.jpeg)\n\nमैं Janakisetty Dhanush Babu हूँ — B.Tech CSE (3rd Year), PBR Visvodaya Institute. AI, computer vision, full-stack मैं passionate.\n\nContact: janakisettydhanushbabu333@gmail.com | +91-9012345678\n\nSkills: Python, Java, HTML, CSS, MySQL, ML, OpenCV, MediaPipe, TensorFlow, Flutter, Full-stack.\n\nProjects:\n- Virtual Keyboard & Air Mouse\n- Tropical Cloud Cluster Detection\n- Gesture Control Presenter\n\nYou can connect with him:\n[GitHub]() [LinkedIn](https://linkedin.com/in/dhanushbabujanakisetty) [Resume](https://drive.google.com/file/d/1SxAgTUVVsXIlN8yxjZhd9VMzvf7uiVSB/view?usp=sharing)", [])
        return ("![Developer Photo](frontend-app/src/assets/developer-photo.jpeg)\n\nI'm **Janakisetty Dhanush Babu** — B.Tech CSE (3rd Year), PBR Visvodaya Institute of Technology and Science, Kavali, Nellore, A.P. I'm passionate about AI, computer vision, and full-stack development.\n\n**Contact:** janakisettydhanushbabu333@gmail.com | +91-9012345678\n\n**Skills:** Python, Java, HTML, CSS, MySQL, Machine Learning, OpenCV, MediaPipe, TensorFlow, Flutter, Full-stack development.\n\n**Standout projects:**\n- Virtual Keyboard & Air Mouse System (Python, OpenCV, MediaPipe)\n- Tropical Cloud Cluster Detection model\n- Gesture Control Presenter\n\n**You can connect with him:**\n[GitHub]()\n[LinkedIn](https://linkedin.com/in/dhanushbabujanakisetty)\n[View Resume](https://drive.google.com/file/d/1SxAgTUVVsXIlN8yxjZhd9VMzvf7uiVSB/view?usp=sharing)", [])
    # Model selection: use gemini-2.5-flash-lite as primary vision model,
    # gemini-2.5-flash as fallback for 400/404, gemini-2.5-pro as third option
    # For text-only: gemini-3.5-flash-lite primary, gemini-2.5-pro fallback
    if image_base64:
        # Image analysis path - use vision models
        vision_model_primary = "gemini-2.5-flash-lite"
        vision_model_fallback = "gemini-2.5-flash"
        vision_model_tertiary = "gemini-2.5-pro"
        models = [vision_model_primary, vision_model_fallback, vision_model_tertiary]
    else:
        # Text-only path - use text models
        text_model = "gemini-3.5-flash-lite"
        models = [text_model, "gemini-2.5-pro", "gemini-2.5-flash-preview-tts"]

    seen = set()
    uniq = [m for m in models if m and not (m in seen or seen.add(m))]

    for model_idx, model in enumerate(uniq):
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={os.environ.get('GEMINI_API_KEY','')}"
        for attempt in range(3):
            import requests, time
            try:
                history_items = []
                if conversation_id is not None:
                    try:
                        hist = load_history(conversation_id)
                        for row in hist or []:
                            mapped = "model" if row.get("role") == "assistant" else row.get("role")
                            item = {"role": mapped, "parts": [{"text": row.get("content", "")}]}
                            history_items.append(item)
                    except Exception:
                        pass

                # Build contents: previous messages + current user message
                user_parts = [{"text": str(user_message)}]
                if image_base64:
                    user_parts.append({
                        "inlineData": {
                            "mimeType": image_media_type if image_media_type in ("image/jpeg","image/png","image/webp") else "image/jpeg",
                            "data": image_base64,
                        }
                    })
                contents = history_items + [{"role": "user", "parts": user_parts}]
                payload = {"contents": contents, "system_instruction": {"parts": [{"text": "Be helpful and concise."}]}, "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048}}
                r = requests.post(url, headers={'Content-Type': 'application/json'}, json=payload, timeout=60)
                d = r.json()

                # Log actual Gemini HTTP status for debugging
                if r.status_code != 200:
                    print(f'[GEMINI ERROR] model={model} status={r.status_code} error={d.get("error", {})} msg={str(user_message)[:20]}', flush=True)

                is_429 = r.status_code == 429 or any(k in str(d.get('error', {})).lower() for k in ('quota', '429', 'rate limit'))
                if is_429:
                    wait_time = 1 * (2 ** attempt)
                    time.sleep(wait_time)
                    continue

                if r.status_code == 200 and d.get('candidates'):
                    text = d['candidates'][0].get('content', {}).get('parts', [{}])[0].get('text', '')
                    print(f'[ANSWERED] model={model} msg={str(user_message)[:20]}', flush=True)
                    return (str(text)[:500], [])

                # Handle 400/404: retry once with fallback vision model (only for primary vision model)
                if r.status_code in (400, 404) and image_base64:
                    if model_idx == 0:  # Primary vision model failed
                        print(f'[FALLBACK-{r.status_code}] model={model} msg={str(user_message)[:20]}', flush=True)
                        # Retry once with fallback model
                        fallback_url = f"https://generativelanguage.googleapis.com/v1beta/models/{vision_model_fallback}:generateContent?key={os.environ.get('GEMINI_API_KEY','')}"
                        try:
                            r2 = requests.post(fallback_url, headers={'Content-Type': 'application/json'}, json=payload, timeout=60)
                            d2 = r2.json()
                            if r2.status_code == 200 and d2.get('candidates'):
                                text = d2['candidates'][0].get('content', {}).get('parts', [{}])[0].get('text', '')
                                print(f'[ANSWERED-FALLBACK] model={vision_model_fallback} msg={str(user_message)[:20]}', flush=True)
                                return (str(text)[:500], [])
                            else:
                                print(f'[FALLBACK FAILED] model={vision_model_fallback} status={r2.status_code} error={d2.get("error", {})}', flush=True)
                        except Exception as e2:
                            print(f'[FALLBACK EXCEPTION] model={vision_model_fallback} error={e2}', flush=True)
                    break  # Try next model in the chain

                if r.status_code == 404:
                    print(f'[FALLBACK-404] model={model} msg={str(user_message)[:20]}', flush=True)
                    break  # try next model

            except Exception as e:
                if any(k in str(e).lower() for k in ('quota', '429', 'rate limit')):
                    wait_time = 1 * (2 ** attempt)
                    time.sleep(wait_time)
                    continue
                # Log other exceptions
                print(f'[EXCEPTION] model={model} attempt={attempt} error={e}', flush=True)

    # After all models exhausted: if image was attached, return friendly message.
    if image_base64:
        return ("Image analysis is temporarily unavailable because Gemini's vision service is busy. Please try again in a moment.", [])

    # Groq fallback (free tier) — allowed ONLY for text-only (image_base64 is None).
    try:
        groq_key = os.environ.get("GROQ_API_KEY", "")
        if not groq_key:
            raise Exception("no groq key")
        groq_model = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
        if groq_key:
            url = "https://api.groq.com/openai/v1/chat/completions"
            payload = {"model": groq_model, "messages": [{"role": "user", "content": str(user_message)}], "max_tokens": 2048}
            r = requests.post(url, headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"}, json=payload, timeout=60)
            if r.status_code == 200:
                d = r.json()
                text = d.get("choices", [{}])[0].get("message", {}).get("content", "")
                print(f"[ANSWERED] provider=Groq model={groq_model} msg={str(user_message)[:20]}", flush=True)
                return (str(text)[:500], [])
    except Exception:
        pass

    return ("Gemini busy right now. Try again shortly.", [])

# ---------------------------------------------------------------------------
# API ROUTES
# ---------------------------------------------------------------------------
class ChatRequest(BaseModel):
    message: str
    conversation_id: int


class ConversationPatch(BaseModel):
    title: str | None = None
    pinned: bool | None = None


def _require_owned_conversation(conversation_id: int, user_id: str):
    conv = get_conversation(conversation_id, user_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


# ---------------------------------------------------------------------------
# CONVERSATIONS — list, create, rename, pin/unpin
# ---------------------------------------------------------------------------
@app.get("/conversations")
async def list_user_conversations(user=Depends(get_current_user)):
    """Lists the logged-in user's conversations, pinned first, then newest."""
    return {"conversations": list_conversations(user["user_id"])}


@app.post("/conversations")
async def new_conversation(user=Depends(get_current_user)):
    """Creates a new, empty conversation for the logged-in user."""
    conv = create_conversation(user["user_id"])
    return {"conversation_id": conv["id"]}


@app.patch("/conversations/{conversation_id}")
async def patch_conversation(conversation_id: int, req: ConversationPatch, user=Depends(get_current_user)):
    """Renames and/or pin/unpins a conversation (owner-only)."""
    row = update_conversation(
        conversation_id, user["user_id"],
        title=req.title, pinned=req.pinned,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"conversation": row}


@app.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: int, user=Depends(get_current_user)):
    """Deletes a conversation and its messages (owner-only)."""
    conv = get_conversation(conversation_id, user["user_id"])
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    # Delete messages first, then the conversation.
    db.table("messages").delete().eq("conversation_id", conversation_id).execute()
    db.table("conversations").delete().eq("id", conversation_id).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# HISTORY — per-conversation
# ---------------------------------------------------------------------------
@app.get("/history")
async def history(conversation_id: int, user=Depends(get_current_user)):
    """Returns messages for ONE conversation (ownership-checked)."""
    _require_owned_conversation(conversation_id, user["user_id"])
    return {"messages": load_history(conversation_id)}


# ---------------------------------------------------------------------------
# PROFILE — display_name + avatar, stored in a `profiles` table.
# Run the migration SQL in Supabase SQL Editor first (see profiles_migration.sql).
# ---------------------------------------------------------------------------
class ProfileUpdate(BaseModel):
    display_name: str | None = None
    avatar_url: str | None = None


@app.get("/profile")
async def get_profile(user=Depends(get_current_user)):
    """Returns the current user's profile (display_name, avatar_url)."""
    try:
        res = db.table("profiles").select("display_name, avatar_url").eq("user_id", user["user_id"]).limit(1).execute()
        rows = res.data or []
        if rows:
            return rows[0]
    except Exception:
        pass
    return {"display_name": "", "avatar_url": ""}


@app.post("/profile")
async def update_profile(req: ProfileUpdate, user=Depends(get_current_user)):
    """Creates or updates the current user's profile."""
    existing = None
    try:
        res = db.table("profiles").select("user_id").eq("user_id", user["user_id"]).limit(1).execute()
        existing = (res.data or [None])[0]
    except Exception:
        pass

    update_data = {}
    if req.display_name is not None:
        update_data["display_name"] = req.display_name
    if req.avatar_url is not None:
        update_data["avatar_url"] = req.avatar_url

    if existing:
        db.table("profiles").update(update_data).eq("user_id", user["user_id"]).execute()
    else:
        update_data["user_id"] = user["user_id"]
        db.table("profiles").insert(update_data).execute()

    return {"ok": True}


@app.post("/profile/avatar")
async def upload_profile_avatar(
    avatar: UploadFile = File(...),
    user=Depends(get_current_user),
):
    """Upload a profile avatar image, store in chat-images bucket under avatars/ prefix."""
    avatar_bytes = await avatar.read()
    if len(avatar_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Avatar must be under 5 MB")

    filename = f"avatars/{user['user_id']}.jpg"
    public_url = f"{SUPABASE_URL}/storage/v1/object/public/{IMAGE_BUCKET}/{filename}"

    db.storage.from_(IMAGE_BUCKET).upload(
        filename, avatar_bytes,
        {"content-type": avatar.content_type or "image/jpeg", "upsert": "true"},
    )

    # Update the profile with the new avatar_url.
    try:
        res = db.table("profiles").select("user_id").eq("user_id", user["user_id"]).limit(1).execute()
        if res.data:
            db.table("profiles").update({"avatar_url": public_url}).eq("user_id", user["user_id"]).execute()
        else:
            db.table("profiles").insert({"user_id": user["user_id"], "avatar_url": public_url}).execute()
    except Exception:
        pass

    return {"avatar_url": public_url}


# ---------------------------------------------------------------------------
# CHAT
# ---------------------------------------------------------------------------
@app.post("/chat")
async def chat(req: ChatRequest, user=Depends(get_current_user)):
    """Plain text chat (also used for voice input — transcribe on the frontend first).

    Requires a conversation_id. On a brand-new conversation we auto-generate a
    short title from the first message.
    """
    _require_owned_conversation(req.conversation_id, user["user_id"])

    is_first_message = count_conversation_messages(req.conversation_id) == 0
    if is_first_message:
        title = _generate_title(req.message)
        update_conversation(req.conversation_id, user["user_id"], title=title)

    save_message(user["user_id"], "user", req.message, conversation_id=req.conversation_id)
    reply, images = run_chat(req.message, conversation_id=req.conversation_id)
    save_message(user["user_id"], "assistant", reply, conversation_id=req.conversation_id)
    return {"reply": reply, "conversation_id": req.conversation_id, "images": images}


@app.post("/chat-with-image")
async def chat_with_image(
    message: str = Form(...),
    conversation_id: int = Form(...),
    image: UploadFile = File(...),
    user=Depends(get_current_user),
):
    """Chat with an uploaded image (e.g. 'what is this?').

    Uploads the image to Supabase Storage and stores its public URL on the
    user message so the frontend can render the actual thumbnail.
    """
    _require_owned_conversation(conversation_id, user["user_id"])

    image_bytes = await image.read()
    bad = _validate_image(image_bytes)
    if bad:
        raise HTTPException(status_code=400, detail=bad)
    is_first_message = count_conversation_messages(conversation_id) == 0
    if is_first_message:
        title = _generate_title(message)
        update_conversation(conversation_id, user["user_id"], title=title)

    image_url = upload_image(user["user_id"], image.filename or "image", image_bytes)
    save_message(
        user["user_id"], "user", f"[image] {message}",
        conversation_id=conversation_id, image_url=image_url,
    )
    image_base64 = base64.b64encode(image_bytes).decode("utf-8")
    reply, images = run_chat(
        message,
        image_base64=image_base64,
        image_media_type=image.content_type or "image/jpeg",
        conversation_id=conversation_id,
    )
    save_message(user["user_id"], "assistant", reply, conversation_id=conversation_id)
    return {
        "reply": reply, "conversation_id": conversation_id,
        "image_url": image_url, "images": images,
    }


@app.get("/")
async def root():
    return {"status": "Chatbot backend is running"}