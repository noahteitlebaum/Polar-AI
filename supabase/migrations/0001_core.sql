-- Polar AI core schema: projects, conversations, messages, budgets, ledger, settings, generated-image storage.
-- Apply once: Supabase dashboard → SQL Editor → paste this file → Run (or `supabase db push`).
-- Money is stored in "micros" = millionths of a US dollar (bigint), so $5.00 = 5000000.
-- With prices in $ per 1M tokens, cost in micros = tokens × price, with no float rounding.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- projects
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic', 'google', 'xai')),
  name text not null check (char_length(name) between 1 and 80),
  instructions text not null default '' check (char_length(instructions) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_idx on public.projects (user_id, provider, updated_at desc);

-- ---------------------------------------------------------------- conversations
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic', 'google', 'xai')),
  project_id uuid references public.projects(id) on delete set null,
  title text not null default 'New chat' check (char_length(title) <= 120),
  model_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_user_idx on public.conversations (user_id, provider, updated_at desc);

-- ---------------------------------------------------------------- messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  seq bigint generated always as identity,
  role text not null check (role in ('user', 'assistant')),
  kind text not null default 'text' check (kind in ('text', 'image')),
  content text not null default '',
  image_path text,                       -- storage path in the "generated" bucket for kind = 'image'
  model_id text,
  status text not null default 'complete' check (status in ('complete', 'partial', 'error')),
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, seq);

-- ---------------------------------------------------------------- budgets + ledger (written only by server functions)
create table if not exists public.budgets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  period_start date not null default current_date,
  allowance_micros bigint not null check (allowance_micros >= 0),
  spent_micros bigint not null default 0 check (spent_micros >= 0),
  reserved_micros bigint not null default 0 check (reserved_micros >= 0)
);

create table if not exists public.ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null unique,
  model_id text not null,
  kind text not null default 'text' check (kind in ('text', 'image')),
  reserved_micros bigint not null,
  actual_micros bigint,
  input_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  cached_tokens integer,
  state text not null default 'reserved' check (state in ('reserved', 'settled', 'uncertain', 'released')),
  error_code text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists ledger_user_idx on public.ledger (user_id, created_at desc);

-- Global settings (team only, via dashboard). Keys used by the app:
--   default_allowance_micros  number   budget given to a new account (trial)
--   global_stop               boolean  true = no model calls for anyone
--   disabled_providers        array    e.g. ["xai"]
create table if not exists public.settings (
  key text primary key,
  value jsonb not null
);
insert into public.settings (key, value) values
  ('default_allowance_micros', '5000000'),
  ('global_stop', 'false'),
  ('disabled_providers', '[]')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- row level security
alter table public.projects enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.budgets enable row level security;
alter table public.ledger enable row level security;
alter table public.settings enable row level security;

drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own conversations" on public.conversations;
create policy "own conversations" on public.conversations for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (project_id is null or exists (
      select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid() and p.provider = conversations.provider))
  );

drop policy if exists "own messages" on public.messages;
create policy "own messages" on public.messages for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );

-- Budgets and ledger: users may read their own rows; only server functions write.
drop policy if exists "read own budget" on public.budgets;
create policy "read own budget" on public.budgets for select to authenticated using (user_id = auth.uid());
drop policy if exists "read own ledger" on public.ledger;
create policy "read own ledger" on public.ledger for select to authenticated using (user_id = auth.uid());
-- settings: no policies → no access for users.

-- ---------------------------------------------------------------- budget functions (server only)
-- Atomic reserve. Returns {ok, reason?, remaining_micros}. Idempotent on request_id.
create or replace function public.reserve_budget(
  p_user_id uuid, p_request_id text, p_model_id text, p_kind text, p_bound_micros bigint
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing public.ledger%rowtype;
  v_budget public.budgets%rowtype;
begin
  if p_bound_micros <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_bound');
  end if;

  select * into v_existing from public.ledger where request_id = p_request_id;
  if found then
    if v_existing.user_id <> p_user_id then
      return jsonb_build_object('ok', false, 'reason', 'request_conflict');
    end if;
    return jsonb_build_object('ok', v_existing.state = 'reserved', 'reason', 'duplicate');
  end if;

  if coalesce((select value::text::boolean from public.settings where key = 'global_stop'), false) then
    return jsonb_build_object('ok', false, 'reason', 'global_stop');
  end if;

  insert into public.budgets (user_id, allowance_micros)
  values (p_user_id, coalesce((select value::text::bigint from public.settings where key = 'default_allowance_micros'), 0))
  on conflict (user_id) do nothing;

  update public.budgets
     set reserved_micros = reserved_micros + p_bound_micros
   where user_id = p_user_id
     and allowance_micros - spent_micros - reserved_micros >= p_bound_micros
  returning * into v_budget;

  if not found then
    select * into v_budget from public.budgets where user_id = p_user_id;
    return jsonb_build_object('ok', false, 'reason', 'budget',
      'remaining_micros', v_budget.allowance_micros - v_budget.spent_micros - v_budget.reserved_micros);
  end if;

  insert into public.ledger (user_id, request_id, model_id, kind, reserved_micros)
  values (p_user_id, p_request_id, p_model_id, p_kind, p_bound_micros);

  return jsonb_build_object('ok', true,
    'remaining_micros', v_budget.allowance_micros - v_budget.spent_micros - v_budget.reserved_micros);
end $$;

-- Reconcile. p_state: 'settled' (charge actual), 'uncertain' (charge full reservation), 'released' (charge nothing).
create or replace function public.settle_budget(
  p_request_id text, p_state text, p_actual_micros bigint,
  p_input_tokens integer default null, p_output_tokens integer default null,
  p_reasoning_tokens integer default null, p_cached_tokens integer default null,
  p_error_code text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row public.ledger%rowtype;
  v_charge bigint;
begin
  if p_state not in ('settled', 'uncertain', 'released') then
    raise exception 'bad state %', p_state;
  end if;

  select * into v_row from public.ledger where request_id = p_request_id for update;
  if not found or v_row.state <> 'reserved' then
    return; -- already reconciled (retry-safe)
  end if;

  v_charge := case p_state
    when 'settled' then greatest(coalesce(p_actual_micros, v_row.reserved_micros), 0)
    when 'uncertain' then v_row.reserved_micros
    else 0 end;

  update public.budgets
     set reserved_micros = greatest(reserved_micros - v_row.reserved_micros, 0),
         spent_micros = spent_micros + v_charge
   where user_id = v_row.user_id;

  update public.ledger
     set state = p_state, actual_micros = v_charge,
         input_tokens = p_input_tokens, output_tokens = p_output_tokens,
         reasoning_tokens = p_reasoning_tokens, cached_tokens = p_cached_tokens,
         error_code = p_error_code, settled_at = now()
   where id = v_row.id;
end $$;

-- Only the server (service role / secret key) may call these; students can't reserve or settle for themselves.
revoke all on function public.reserve_budget(uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.settle_budget(text, text, bigint, integer, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.reserve_budget(uuid, text, text, text, bigint) to service_role;
grant execute on function public.settle_budget(text, text, bigint, integer, integer, integer, integer, text) to service_role;

-- ---------------------------------------------------------------- generated images (private bucket)
-- Files live at "<user_id>/<uuid>.png". The server uploads; each user can read only their own folder.
insert into storage.buckets (id, name, public) values ('generated', 'generated', false)
on conflict (id) do nothing;

drop policy if exists "read own generated images" on storage.objects;
create policy "read own generated images" on storage.objects for select to authenticated
  using (bucket_id = 'generated' and (storage.foldername(name))[1] = auth.uid()::text);
