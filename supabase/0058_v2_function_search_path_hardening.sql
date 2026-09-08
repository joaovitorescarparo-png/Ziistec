-- ZiisTec V2: hardening adicional de RPCs SECURITY DEFINER.
-- As funções abaixo já usam referências qualificadas (public./auth./zt_private.).
-- Mantemos search_path vazio para reduzir risco de resolução indevida de objetos.

alter function public.zt_technician_catalog(uuid)
  set search_path = '';

alter function public.zt_adjust_product_stock(uuid,uuid,numeric,text)
  set search_path = '';

alter function public.zt_sell_product_on_work_order(uuid,uuid,numeric,text)
  set search_path = '';

alter function public.zt_create_manual_warranty(uuid,uuid,text,text,date,date,text,uuid,uuid,text,text)
  set search_path = '';

alter function public.zt_generate_maintenance_contract_cycle(uuid,date,date,date)
  set search_path = '';

comment on function public.zt_technician_catalog(uuid) is
  'Catálogo comercial seguro para membro ativo; não retorna custo, margem ou fornecedor.';

comment on function public.zt_sell_product_on_work_order(uuid,uuid,numeric,text) is
  'Venda de produto em OS autorizada para owner ou técnico ativo atribuído; valida estoque e tenant.';
