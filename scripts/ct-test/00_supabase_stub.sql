-- =====================================================================
-- ZiisTec · stub de ambiente Supabase para BANCO DESCARTÁVEL de teste.
-- NUNCA aplicar em um projeto Supabase real: lá estes objetos já existem.
-- Reproduz o mínimo de auth/storage/roles para rodar as migrations e os
-- testes de RLS localmente (Postgres 16 + contrib).
-- =====================================================================

do $$ begin create role anon nologin;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

grant anon, authenticated, service_role to postgres;

-- ------------------------------------------------------------- auth
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Supabase lê o uid/claims do JWT; aqui lemos de request.jwt.claims,
-- exatamente como o GoTrue configura por trás.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;

-- ---------------------------------------------------------- storage
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

create index if not exists idx_objects_bucket_name on storage.objects (bucket_id, name);

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets to service_role;
grant select on storage.buckets to anon, authenticated;
grant all on storage.objects to anon, authenticated, service_role;

-- ------------------------------------------------- objetos legados
-- Existem no banco real desde antes do versionamento das migrations;
-- a 0003 revoga EXECUTE deles. No banco de teste, um stub inofensivo.
create or replace function public.rls_auto_enable() returns trigger
language plpgsql as $$ begin return null; end $$;

-- ------------------------------------------------- sessão de teste
-- tests.login(uid) simula um usuário autenticado; tests.anon() a sessão
-- anônima; tests.reset() volta ao superusuário.
create schema if not exists tests;
grant usage on schema tests to public;

create or replace function tests.login(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, false);
  execute 'set role authenticated';
end $$;

create or replace function tests.anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  execute 'set role anon';
end $$;

create or replace function tests.reset() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;

-- assert simples para os testes SQL
create or replace function tests.ok(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'TESTE FALHOU: %', msg;
  end if;
end $$;

grant execute on all functions in schema tests to public;
