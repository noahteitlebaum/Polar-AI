-- Polar AI 0002: uploads (PDF/DOCX/TXT/images), searchable passages with page references,
-- courses shared across all four apps, study modes, and sources saved on answers.
-- Apply after 0001: Supabase → SQL Editor → paste this whole file → Run. Safe to run twice.

-- ---------------------------------------------------------------- courses (projects) shared across apps
-- New courses have provider = null and show in every app. Older per-app projects keep their provider.
alter table public.projects alter column provider drop not null;

drop policy if exists "own conversations" on public.conversations;
create policy "own conversations" on public.conversations for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (project_id is null or exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
        and (p.provider is null or p.provider = conversations.provider)))
  );

-- ---------------------------------------------------------------- chat settings + answer metadata
alter table public.conversations add column if not exists mode text not null default 'chat';
alter table public.conversations drop constraint if exists conversations_mode_check;
alter table public.conversations add constraint conversations_mode_check check (mode in ('chat', 'explain', 'quiz', 'hints'));
alter table public.conversations add column if not exists course_only boolean not null default false;
-- Long chats: a running summary of messages that no longer fit, up to (and including) message seq summary_upto.
alter table public.conversations add column if not exists summary text;
alter table public.conversations add column if not exists summary_upto bigint;

alter table public.messages add column if not exists attachment_ids uuid[] not null default '{}';
alter table public.messages add column if not exists sources jsonb;  -- passages actually sent with this answer

-- ---------------------------------------------------------------- files
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,          -- course file
  conversation_id uuid references public.conversations(id) on delete cascade, -- chat attachment
  name text not null check (char_length(name) between 1 and 200),
  mime text not null,
  size_bytes integer not null check (size_bytes > 0),
  storage_path text not null,
  kind text not null check (kind in ('document', 'image')),
  status text not null default 'ready' check (status in ('ready', 'failed', 'needs_ocr')),
  page_count integer,
  char_count integer,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists files_user_idx on public.files (user_id, created_at desc);
create index if not exists files_project_idx on public.files (project_id);
create index if not exists files_conversation_idx on public.files (conversation_id);

create table if not exists public.file_chunks (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.files(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page integer,              -- PDF page / slide number; null for DOCX/TXT (we use part numbers)
  chunk_index integer not null,
  content text not null,
  tsv tsvector generated always as (to_tsvector('english', content)) stored
);
create index if not exists file_chunks_file_idx on public.file_chunks (file_id, chunk_index);
create index if not exists file_chunks_tsv_idx on public.file_chunks using gin (tsv);

alter table public.files enable row level security;
alter table public.file_chunks enable row level security;

drop policy if exists "own files" on public.files;
create policy "own files" on public.files for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
    and (conversation_id is null or exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  );

drop policy if exists "own chunks" on public.file_chunks;
create policy "own chunks" on public.file_chunks for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.files f where f.id = file_id and f.user_id = auth.uid()));

-- Keyword search over the given files (runs as the student, so RLS limits it to their own passages).
-- Any word can match ("OR"); passages with more and closer matches rank higher.
create or replace function public.search_chunks(p_query text, p_file_ids uuid[], p_limit integer default 8)
returns table (chunk_id uuid, file_id uuid, page integer, chunk_index integer, content text, rank real)
language sql stable security invoker set search_path = public as $$
  with q as (
    select to_tsquery('english', string_agg(quote_literal(lexeme), ' | ')) as tsq
    from unnest(to_tsvector('english', coalesce(p_query, '')))
  )
  select c.id, c.file_id, c.page, c.chunk_index, c.content, ts_rank_cd(c.tsv, q.tsq) as rank
  from public.file_chunks c, q
  where q.tsq is not null
    and c.file_id = any(p_file_ids)
    and c.tsv @@ q.tsq
  order by rank desc, c.chunk_index
  limit greatest(1, least(p_limit, 30));
$$;
grant execute on function public.search_chunks(text, uuid[], integer) to authenticated;

-- ---------------------------------------------------------------- upload storage (private)
-- Files live at "<user_id>/<file_id>/<name>". Each student can only touch their own folder.
insert into storage.buckets (id, name, public) values ('uploads', 'uploads', false)
on conflict (id) do nothing;

drop policy if exists "read own uploads" on storage.objects;
create policy "read own uploads" on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "add own uploads" on storage.objects;
create policy "add own uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "delete own uploads" on storage.objects;
create policy "delete own uploads" on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);
