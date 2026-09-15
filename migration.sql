-- =============================================================================
-- Ben AI — migrations for "conversations" (multi-chat) + image attachments
-- =============================================================================
-- How to run:
--   1. Open your Supabase dashboard -> SQL Editor -> New query
--   2. Paste this ENTIRE file (or Run Selected on each block) and click Run.
--   3. It is safe to run more than once (idempotent).
--
-- This adds:
--   * a `conversations` table (one chat thread per row)
--   * a `conversation_id` column on `messages`, linked to conversations.id
--   * an `image_url` column on `messages`, for uploaded images (task #3)
--   * a backfill: every pre-existing message is grouped into an
--     "Imported history" conversation per user, so old chat is NOT lost.
-- =============================================================================

-- 1) Conversations table ------------------------------------------------------
create table if not exists conversations (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  title text not null default 'New chat',
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2) New columns on messages ---------------------------------------------------
alter table messages
  add column if not exists conversation_id bigint references conversations(id);
alter table messages
  add column if not exists image_url text;

-- 3) Indexes (speeds up per-conversation history queries) ----------------------
create index if not exists messages_conversation_id_idx
  on messages (conversation_id);
create index if not exists conversations_user_id_idx
  on conversations (user_id);

-- 4) Backfill: move existing messages into one "Imported history" conversation
--    per user ----------------------------------------------------------------
insert into conversations (user_id, title)
select distinct user_id, 'Imported history'
from messages
where conversation_id is null;

update messages m
set conversation_id = c.id
from conversations c
where m.conversation_id is null
  and m.user_id = c.user_id
  and c.title = 'Imported history';