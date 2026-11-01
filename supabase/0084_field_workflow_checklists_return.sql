-- ZiisTec · FIELD WORKFLOW V1 · Wave 3B
-- Checklist templates por empresa + "Precisa retornar" sem concluir a OS.
-- Reutiliza work_order_checklists; retorno é filho operacional da OS, não nova OS/agenda.

-- =============================================================================
-- CHECKLIST TEMPLATES (owner-only administration)
-- =============================================================================
create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint checklist_templates_name_len check (char_length(name) between 1 and 300),
  constraint checklist_templates_description_len check (description is null or char_length(description) <= 2000),
  unique(company_id,id)
);

create table if not exists public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  template_id uuid not null,
  position integer not null default 0,
  text text not null,
  required boolean not null default false,
  created_at timestamptz not null default now(),
  constraint checklist_template_items_template_company_fk
    foreign key (template_id,company_id) references public.checklist_templates(id,company_id) on delete cascade,
  constraint checklist_template_items_position_ck check (position between 0 and 999),
  constraint checklist_template_items_text_len check (char_length(text) between 1 and 500),
  unique(template_id,position)
);

create index if not exists idx_checklist_templates_company_active
  on public.checklist_templates(company_id,active,name);
create index if not exists idx_checklist_template_items_order
  on public.checklist_template_items(company_id,template_id,position);

alter table public.checklist_templates enable row level security;
alter table public.checklist_template_items enable row level security;

revoke all on public.checklist_templates from anon,authenticated;
revoke all on public.checklist_template_items from anon,authenticated;
grant select on public.checklist_templates to authenticated;
grant select on public.checklist_template_items to authenticated;

drop policy if exists checklist_templates_owner_select on public.checklist_templates;
create policy checklist_templates_owner_select on public.checklist_templates
for select to authenticated using (public.zt_is_owner(company_id));

drop policy if exists checklist_template_items_owner_select on public.checklist_template_items;
create policy checklist_template_items_owner_select on public.checklist_template_items
for select to authenticated using (public.zt_is_owner(company_id));

-- Subscription guard das tabelas administrativas. As escritas são somente via RPC.
drop trigger if exists trg_subscription_write_guard on public.checklist_templates;
create trigger trg_subscription_write_guard
before insert or update or delete on public.checklist_templates
for each row execute function public.zt_guard_subscription_write();

drop trigger if exists trg_subscription_write_guard on public.checklist_template_items;
create trigger trg_subscription_write_guard
before insert or update or delete on public.checklist_template_items
for each row execute function public.zt_guard_subscription_write();

-- Snapshot na OS: a alteração posterior do template não muda checklist já aplicado.
alter table public.work_order_checklists
  add column if not exists required boolean not null default false,
  add column if not exists source_template_id uuid,
  add column if not exists source_template_item_id uuid;

create index if not exists idx_wo_checklists_template_source
  on public.work_order_checklists(work_order_id,source_template_id,position)
  where source_template_id is not null;

-- Técnico continua podendo marcar/desmarcar e criar item ad-hoc opcional em OS aberta,
-- mas não altera texto/ordem/obrigatoriedade de item vindo de template nem o apaga.
create or replace function public.zt_guard_checklist_identity()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
begin
  if current_user='authenticated' then
    new.company_id := old.company_id;
    new.work_order_id := old.work_order_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if not public.zt_is_owner(old.company_id) then
      new.text := old.text;
      new.position := old.position;
      new.required := old.required;
      new.source_template_id := old.source_template_id;
      new.source_template_item_id := old.source_template_item_id;
    end if;
  end if;
  return new;
end $$;

revoke all on function public.zt_guard_checklist_identity() from public,anon,authenticated;

drop policy if exists p_wo_checklist_insert on public.work_order_checklists;
create policy p_wo_checklist_insert on public.work_order_checklists
for insert to authenticated
with check (
  public.zt_wo_is_owned(work_order_id)
  or (
    public.zt_wo_is_mine(work_order_id)
    and public.zt_wo_open(work_order_id)
    and created_by=(select auth.uid())
    and required=false
    and source_template_id is null
    and source_template_item_id is null
  )
);

drop policy if exists p_wo_checklist_update on public.work_order_checklists;
create policy p_wo_checklist_update on public.work_order_checklists
for update to authenticated
using (
  public.zt_wo_is_owned(work_order_id)
  or (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id))
)
with check (
  public.zt_wo_is_owned(work_order_id)
  or (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id))
);

drop policy if exists p_wo_checklist_delete on public.work_order_checklists;
create policy p_wo_checklist_delete on public.work_order_checklists
for delete to authenticated
using (
  public.zt_wo_is_owned(work_order_id)
  or (
    public.zt_wo_is_mine(work_order_id)
    and public.zt_wo_open(work_order_id)
    and required=false
    and source_template_id is null
  )
);

-- Salva template + itens de forma atômica. company_id recebido é sempre validado por ownership.
create or replace function public.zt_save_checklist_template(
  p_company uuid,
  p_template uuid default null,
  p_name text default null,
  p_description text default null,
  p_active boolean default true,
  p_items jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  r jsonb;
  v_text text;
  v_pos integer := 0;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_company is null or not zt_private.is_owner(p_company) then
    raise exception 'Somente o proprietário administra templates' using errcode='42501';
  end if;
  perform zt_private.assert_operational_write_allowed(p_company);

  if nullif(btrim(coalesce(p_name,'')),'') is null or char_length(btrim(p_name))>300 then
    raise exception 'Nome do template inválido' using errcode='22023';
  end if;
  if p_description is not null and char_length(p_description)>2000 then
    raise exception 'Descrição do template muito longa' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then
    raise exception 'Itens do template precisam ser uma lista' using errcode='22023';
  end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))>100 then
    raise exception 'Template pode ter no máximo 100 itens' using errcode='22023';
  end if;

  if p_template is null then
    insert into public.checklist_templates(company_id,name,description,active,created_by)
    values(p_company,btrim(p_name),nullif(btrim(coalesce(p_description,'')),''),coalesce(p_active,true),auth.uid())
    returning id into v_id;
  else
    select t.id into v_id
      from public.checklist_templates t
     where t.id=p_template and t.company_id=p_company
     for update;
    if not found then raise exception 'Template não pertence à empresa' using errcode='42501'; end if;
    update public.checklist_templates
       set name=btrim(p_name),
           description=nullif(btrim(coalesce(p_description,'')),''),
           active=coalesce(p_active,true),
           updated_at=now()
     where id=v_id;
    delete from public.checklist_template_items where template_id=v_id and company_id=p_company;
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_text := btrim(coalesce(r->>'text',''));
    if v_text='' or char_length(v_text)>500 then
      raise exception 'Item de checklist inválido' using errcode='22023';
    end if;
    insert into public.checklist_template_items(company_id,template_id,position,text,required)
    values(p_company,v_id,v_pos,v_text,coalesce((r->>'required')::boolean,false));
    v_pos := v_pos+1;
  end loop;
  return v_id;
end;
$$;
revoke all on function public.zt_save_checklist_template(uuid,uuid,text,text,boolean,jsonb) from public,anon;
grant execute on function public.zt_save_checklist_template(uuid,uuid,text,text,boolean,jsonb) to authenticated,service_role;

-- Aplicação é snapshot e idempotente: um mesmo template só é aplicado uma vez por OS.
create or replace function public.zt_apply_checklist_template(
  p_wo uuid,
  p_template uuid
) returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_wo public.work_orders%rowtype;
  v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  select w.* into v_wo from public.work_orders w where w.id=p_wo for update;
  if not found then raise exception 'OS não encontrada' using errcode='P0002'; end if;
  if not zt_private.is_owner(v_wo.company_id) then
    raise exception 'Somente o proprietário aplica template' using errcode='42501';
  end if;
  perform zt_private.assert_operational_write_allowed(v_wo.company_id);
  if v_wo.status in ('done','canceled') then
    raise exception 'Checklist não pode ser aplicado em OS encerrada' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.checklist_templates t
     where t.id=p_template and t.company_id=v_wo.company_id and t.active
  ) then
    raise exception 'Template ativo não pertence à empresa da OS' using errcode='42501';
  end if;

  if exists(
    select 1 from public.work_order_checklists c
     where c.work_order_id=p_wo and c.company_id=v_wo.company_id and c.source_template_id=p_template
  ) then
    select count(*) into v_count from public.work_order_checklists c
     where c.work_order_id=p_wo and c.company_id=v_wo.company_id and c.source_template_id=p_template;
    return v_count;
  end if;

  insert into public.work_order_checklists(
    work_order_id,company_id,text,done,position,created_by,required,source_template_id,source_template_item_id
  )
  select p_wo,v_wo.company_id,i.text,false,
         coalesce((select max(c.position)+1 from public.work_order_checklists c where c.work_order_id=p_wo),0)+i.position,
         auth.uid(),i.required,p_template,i.id
    from public.checklist_template_items i
   where i.template_id=p_template and i.company_id=v_wo.company_id
   order by i.position;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.zt_apply_checklist_template(uuid,uuid) from public,anon;
grant execute on function public.zt_apply_checklist_template(uuid,uuid) to authenticated,service_role;

-- =============================================================================
-- PRECISA RETORNAR
-- =============================================================================
create table if not exists public.work_order_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  work_order_id uuid not null,
  reason text not null,
  material_needed text,
  notes text,
  priority text not null default 'normal',
  expected_return_date date,
  returned_at timestamptz,
  resolved_at timestamptz,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint work_order_returns_wo_company_fk
    foreign key (work_order_id,company_id) references public.work_orders(id,company_id) on delete cascade,
  constraint work_order_returns_reason_len check (char_length(reason) between 1 and 3000),
  constraint work_order_returns_material_len check (material_needed is null or char_length(material_needed)<=3000),
  constraint work_order_returns_notes_len check (notes is null or char_length(notes)<=5000),
  constraint work_order_returns_priority_ck check (priority in ('low','normal','high','urgent')),
  unique(company_id,request_id)
);

create index if not exists idx_work_order_returns_history
  on public.work_order_returns(company_id,work_order_id,created_at desc);
create index if not exists idx_work_order_returns_pending
  on public.work_order_returns(company_id,expected_return_date,priority)
  where resolved_at is null;

alter table public.work_order_returns enable row level security;
revoke all on public.work_order_returns from anon,authenticated;
grant select on public.work_order_returns to authenticated;

drop policy if exists work_order_returns_visible on public.work_order_returns;
create policy work_order_returns_visible on public.work_order_returns
for select to authenticated
using (public.zt_is_owner(company_id) or public.zt_wo_is_mine(work_order_id));

drop trigger if exists trg_subscription_write_guard on public.work_order_returns;
create trigger trg_subscription_write_guard
before insert or update or delete on public.work_order_returns
for each row execute function public.zt_guard_subscription_write();

create or replace function public.zt_mark_work_order_needs_return(
  p_wo uuid,
  p_reason text,
  p_material_needed text default null,
  p_notes text default null,
  p_priority text default 'normal',
  p_expected_return_date date default null,
  p_request_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_wo public.work_orders%rowtype;
  v_uid uuid := auth.uid();
  v_allowed boolean := false;
  v_existing uuid;
  v_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_priority text := lower(coalesce(nullif(btrim(p_priority),''),'normal'));
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_request_id is null then raise exception 'Identificador da operação obrigatório' using errcode='22023'; end if;
  if v_reason is null or char_length(v_reason)>3000 then raise exception 'Informe o motivo do retorno' using errcode='22023'; end if;
  if p_material_needed is not null and char_length(p_material_needed)>3000 then raise exception 'Material necessário muito longo' using errcode='22023'; end if;
  if p_notes is not null and char_length(p_notes)>5000 then raise exception 'Observação muito longa' using errcode='22023'; end if;
  if v_priority not in ('low','normal','high','urgent') then raise exception 'Prioridade inválida' using errcode='22023'; end if;
  if p_expected_return_date is not null and p_expected_return_date < current_date then
    raise exception 'Previsão de retorno não pode estar no passado' using errcode='22023';
  end if;

  select w.* into v_wo from public.work_orders w where w.id=p_wo and w.deleted_at is null for update;
  if not found then raise exception 'OS não encontrada' using errcode='P0002'; end if;
  if v_wo.status in ('done','canceled') then raise exception 'OS encerrada não pode receber pendência de retorno' using errcode='42501'; end if;

  v_allowed := zt_private.is_owner(v_wo.company_id) or (
    v_wo.assigned_to=v_uid and exists(
      select 1 from public.company_members m
       where m.company_id=v_wo.company_id and m.user_id=v_uid
         and m.role='technician' and m.status='active'
    )
  );
  if not v_allowed then raise exception 'Sem permissão para esta OS' using errcode='42501'; end if;
  perform zt_private.assert_operational_write_allowed(v_wo.company_id);

  select r.id into v_existing
    from public.work_order_returns r
   where r.company_id=v_wo.company_id and r.request_id=p_request_id;
  if found then
    if not exists(select 1 from public.work_order_returns r where r.id=v_existing and r.work_order_id=p_wo) then
      raise exception 'Identificador de operação já usado em outro atendimento' using errcode='23505';
    end if;
    return v_existing;
  end if;

  -- Se esta é uma nova visita após uma pendência anterior, preserva a tentativa anterior
  -- com a data real em que o técnico voltou e abre uma nova pendência.
  update public.work_order_returns
     set returned_at=coalesce(returned_at,now()), resolved_at=coalesce(resolved_at,now())
   where company_id=v_wo.company_id and work_order_id=p_wo and resolved_at is null;

  insert into public.work_order_returns(
    company_id,work_order_id,reason,material_needed,notes,priority,
    expected_return_date,request_id,created_by
  ) values(
    v_wo.company_id,p_wo,v_reason,nullif(btrim(coalesce(p_material_needed,'')),''),
    nullif(btrim(coalesce(p_notes,'')),''),v_priority,p_expected_return_date,p_request_id,v_uid
  ) returning id into v_id;

  update public.work_orders
     set needs_return=true,
         pending_note=coalesce(nullif(pending_note,''),left('Retorno: '||v_reason,5000)),
         updated_at=now()
   where id=p_wo;

  return v_id;
end;
$$;
revoke all on function public.zt_mark_work_order_needs_return(uuid,text,text,text,text,date,uuid) from public,anon;
grant execute on function public.zt_mark_work_order_needs_return(uuid,text,text,text,text,date,uuid) to authenticated,service_role;

-- Backend authority para checklist obrigatório e encerramento do histórico de retorno.
-- Não altera a semântica dos status: somente intercepta a transição já existente para done.
create or replace function zt_private.zt_wave3b_before_work_order_done()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status='done' and old.status is distinct from new.status then
    if exists(
      select 1 from public.work_order_checklists c
       where c.work_order_id=new.id and c.company_id=new.company_id
         and c.required and not c.done
    ) then
      raise exception 'Conclua os itens obrigatórios do checklist antes de finalizar a OS' using errcode='23514';
    end if;

    update public.work_order_returns
       set returned_at=coalesce(returned_at,now()), resolved_at=coalesce(resolved_at,now())
     where company_id=new.company_id and work_order_id=new.id and resolved_at is null;
    new.needs_return := false;
  end if;
  return new;
end;
$$;
revoke all on function zt_private.zt_wave3b_before_work_order_done() from public,anon,authenticated;
grant execute on function zt_private.zt_wave3b_before_work_order_done() to service_role;

drop trigger if exists zt_wave3b_before_work_order_done on public.work_orders;
create trigger zt_wave3b_before_work_order_done
before update of status on public.work_orders
for each row execute function zt_private.zt_wave3b_before_work_order_done();

comment on table public.checklist_templates is 'Templates de checklist administrados pelo owner; aplicação gera snapshot em work_order_checklists.';
comment on table public.work_order_returns is 'Histórico operacional das tentativas em que uma OS precisa de retorno; não é nova OS nem agenda.';
