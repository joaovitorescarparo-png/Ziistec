-- ZiisTec: hardening de helpers legados usados por RLS/RPC.
-- Mantém compatibilidade com as policies atuais, reduz vazamento booleano entre tenants
-- e remove search_path mutável dos wrappers públicos SECURITY DEFINER.

-- -----------------------------------------------------------------------------
-- Subscription helper: antes qualquer authenticated que soubesse o UUID da empresa
-- conseguia descobrir se a assinatura permitia escrita. Agora a resposta só existe
-- para membro ativo da empresa ou admin da plataforma.
create or replace function zt_private.subscription_can_write(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    zt_private.is_member(p_company)
    or zt_private.is_platform_admin()
  ) and exists (
    select 1
      from public.subscriptions s
     where s.company_id = p_company
       and s.status in ('trial','active')
       and (s.current_period_end is null or s.current_period_end >= current_date)
  );
$$;

create or replace function public.zt_subscription_can_write(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select zt_private.subscription_can_write(target);
$$;
revoke all on function public.zt_subscription_can_write(uuid) from public, anon;
grant execute on function public.zt_subscription_can_write(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- OS helper: estado aberto/fechado não deve ser consultável entre tenants.
-- Continua compatível com as policies que já combinam mine/owned + open.
create or replace function zt_private.wo_open(w_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.work_orders w
     where w.id = w_id
       and w.status not in ('done','canceled')
       and (
         zt_private.is_owner(w.company_id)
         or (
           w.assigned_to = auth.uid()
           and exists (
             select 1
               from public.company_members m
              where m.company_id = w.company_id
                and m.user_id = auth.uid()
                and m.status = 'active'
           )
         )
       )
  );
$$;

create or replace function public.zt_wo_open(w_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select zt_private.wo_open(w_id);
$$;
revoke all on function public.zt_wo_open(uuid) from public, anon;
grant execute on function public.zt_wo_open(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Wrappers públicos intencionais. Eles apenas delegam para zt_private com referências
-- qualificadas; search_path vazio reduz risco de resolução indevida de objetos.
alter function public.zt_accept_invites() set search_path = '';
alter function public.zt_cancel_subscription(uuid) set search_path = '';
alter function public.zt_client_visible(uuid,uuid) set search_path = '';
alter function public.zt_compartilha_empresa(uuid) set search_path = '';
alter function public.zt_consume_ai_quota(uuid) set search_path = '';
alter function public.zt_consume_quote_pdf_quota(uuid) set search_path = '';
alter function public.zt_create_company(text,text,boolean,text,text) set search_path = '';
alter function public.zt_is_member(uuid) set search_path = '';
alter function public.zt_is_owner(uuid) set search_path = '';
alter function public.zt_is_platform_admin() set search_path = '';
alter function public.zt_platform_set_subscription_status(uuid,public.zt_sub_status) set search_path = '';
alter function public.zt_reactivate_subscription(uuid) set search_path = '';
alter function public.zt_refresh_subscription_status(uuid) set search_path = '';
alter function public.zt_resolve_work_order_pricing(uuid,jsonb,integer) set search_path = '';
alter function public.zt_save_manual_financial_entry(uuid,uuid,uuid,jsonb) set search_path = '';
alter function public.zt_save_purchase_idempotent(uuid,uuid,uuid,jsonb,jsonb) set search_path = '';
alter function public.zt_save_quote_idempotent(uuid,uuid,uuid,jsonb,jsonb) set search_path = '';
alter function public.zt_save_work_order_idempotent(uuid,uuid,uuid,jsonb,jsonb) set search_path = '';
alter function public.zt_set_financial_paid(uuid,boolean,text) set search_path = '';
alter function public.zt_set_followup_status(uuid,text) set search_path = '';
alter function public.zt_update_team_member(uuid,uuid,text,text,text) set search_path = '';
alter function public.zt_wo_is_mine(uuid) set search_path = '';
alter function public.zt_wo_is_owned(uuid) set search_path = '';

-- Helpers privados chamados por RLS: referências qualificadas e path vazio.
alter function zt_private.client_visible(uuid,uuid) set search_path = '';
alter function zt_private.compartilha_empresa(uuid) set search_path = '';
alter function zt_private.is_member(uuid) set search_path = '';
alter function zt_private.is_owner(uuid) set search_path = '';
alter function zt_private.is_platform_admin() set search_path = '';
alter function zt_private.wo_is_mine(uuid) set search_path = '';
alter function zt_private.wo_is_owned(uuid) set search_path = '';

comment on function public.zt_subscription_can_write(uuid) is
  'Retorna capacidade de escrita somente para membro ativo da empresa ou admin da plataforma.';
comment on function public.zt_wo_open(uuid) is
  'Retorna estado aberto apenas quando o usuário atual tem acesso à OS como owner ou técnico atribuído.';
