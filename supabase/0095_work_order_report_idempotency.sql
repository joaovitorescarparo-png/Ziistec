-- ZiisTec · Bloco 4 — relato técnico sem duplicação em retry/duplo toque/finalização.
--
-- 1. request_id opcional + índice único por OS: o mesmo envio repetido devolve a mesma linha.
-- 2. Trigger de relato: um 'report' idêntico ao último relato da OS não vira nova linha. Cobre o
--    relato repetido na finalização atômica (zt_complete_work_order) sem reescrever a função.
-- 3. zt_save_work_order_report: caminho do app com as mesmas regras de acesso da policy de insert.

alter table public.work_order_reports add column if not exists request_id uuid;

create unique index if not exists uq_work_order_reports_request
  on public.work_order_reports(work_order_id, request_id)
  where request_id is not null;

create or replace function zt_private.zt_skip_duplicate_work_order_report()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare v_last text;
begin
  if new.entry_type <> 'report' then return new; end if;
  select r.body into v_last
    from public.work_order_reports r
   where r.work_order_id=new.work_order_id
     and r.company_id=new.company_id
     and r.entry_type='report'
   order by r.created_at desc, r.id desc
   limit 1;
  if v_last is not null and btrim(v_last)=btrim(new.body) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function zt_private.zt_skip_duplicate_work_order_report() from public, anon, authenticated;

drop trigger if exists zt_skip_duplicate_work_order_report on public.work_order_reports;
create trigger zt_skip_duplicate_work_order_report
  before insert on public.work_order_reports
  for each row execute function zt_private.zt_skip_duplicate_work_order_report();

create or replace function public.zt_save_work_order_report(p_wo uuid, p_body text, p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_wo public.work_orders%rowtype;
  v_text text:=btrim(coalesce(p_body,''));
  v_row public.work_order_reports%rowtype;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_request is null then raise exception 'Identificador da tentativa obrigatório' using errcode='22023'; end if;
  if v_text='' then raise exception 'Escreva ou dite o relato técnico' using errcode='22023'; end if;
  if char_length(v_text)>10000 then
    raise exception 'O relato técnico deve ter no máximo 10.000 caracteres' using errcode='22023';
  end if;

  select w.* into v_wo from public.work_orders w where w.id=p_wo and w.deleted_at is null for update;
  if not found then raise exception 'OS não encontrada' using errcode='P0002'; end if;
  if not (public.zt_wo_is_owned(v_wo.id) or (public.zt_wo_is_mine(v_wo.id) and public.zt_wo_open(v_wo.id))) then
    raise exception 'Sem permissão para registrar relato nesta OS' using errcode='42501';
  end if;

  select r.* into v_row from public.work_order_reports r
   where r.work_order_id=v_wo.id and r.request_id=p_request;
  if found then
    if v_row.entry_type<>'report' or btrim(v_row.body)<>v_text then
      raise exception 'Identificador já usado em outro relato' using errcode='23505';
    end if;
    return to_jsonb(v_row);
  end if;

  select r.* into v_row from public.work_order_reports r
   where r.work_order_id=v_wo.id and r.company_id=v_wo.company_id and r.entry_type='report'
   order by r.created_at desc, r.id desc
   limit 1;
  if found and btrim(v_row.body)=v_text then
    return to_jsonb(v_row);
  end if;

  insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id,request_id)
  values(v_wo.id,v_wo.company_id,'report',v_text,v_uid,p_request)
  returning * into v_row;
  if not found then
    -- Um relato idêntico entrou por outro caminho entre a leitura e a gravação: devolve o existente.
    select r.* into v_row from public.work_order_reports r
     where r.work_order_id=v_wo.id and r.company_id=v_wo.company_id and r.entry_type='report'
     order by r.created_at desc, r.id desc
     limit 1;
  end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.zt_save_work_order_report(uuid,text,uuid) from public, anon;
grant execute on function public.zt_save_work_order_report(uuid,text,uuid) to authenticated;
