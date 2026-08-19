-- ZiisTec · limite de geração de documentos PDF
-- Eventos não ficam acessíveis por tabela ao cliente; apenas o gateway autenticado consome a cota.

create table if not exists public.document_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now(),
  constraint document_usage_kind_ck check (kind in ('quote_pdf'))
);

alter table public.document_usage_events enable row level security;
revoke all on public.document_usage_events from public, anon, authenticated;

create index if not exists ix_document_usage_user_company_kind_created
  on public.document_usage_events(user_id, company_id, kind, created_at desc);

create or replace function zt_private.zt_consume_quote_pdf_quota(p_company uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_minute int;
  v_day int;
  v_status public.zt_sub_status;
  v_end date;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_company is null then raise exception 'Empresa não informada' using errcode='22023'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Somente o proprietário gera PDF de orçamento' using errcode='42501'; end if;

  select status,current_period_end into v_status,v_end from public.subscriptions where company_id=p_company;
  if v_status not in ('trial','active') or (v_end is not null and v_end < current_date) then
    raise exception 'Assinatura inativa' using errcode='42501';
  end if;

  select count(*) into v_minute
  from public.document_usage_events
  where user_id=v_uid and company_id=p_company and kind='quote_pdf'
    and created_at > now()-interval '1 minute';
  if v_minute >= 30 then raise exception 'Muitos PDFs em pouco tempo. Aguarde um minuto' using errcode='P0001'; end if;

  select count(*) into v_day
  from public.document_usage_events
  where user_id=v_uid and company_id=p_company and kind='quote_pdf'
    and created_at > now()-interval '24 hours';
  if v_day >= 300 then raise exception 'Limite diário de PDFs atingido' using errcode='P0001'; end if;

  insert into public.document_usage_events(user_id,company_id,kind) values(v_uid,p_company,'quote_pdf');
  delete from public.document_usage_events where created_at < now()-interval '30 days';
  return p_company;
end $$;

create or replace function public.zt_consume_quote_pdf_quota(p_company uuid)
returns uuid
language sql
security definer
set search_path=zt_private
as $$ select zt_private.zt_consume_quote_pdf_quota(p_company); $$;

revoke all on function public.zt_consume_quote_pdf_quota(uuid) from public,anon;
grant execute on function public.zt_consume_quote_pdf_quota(uuid) to authenticated;
revoke all on function zt_private.zt_consume_quote_pdf_quota(uuid) from public,anon,authenticated;
