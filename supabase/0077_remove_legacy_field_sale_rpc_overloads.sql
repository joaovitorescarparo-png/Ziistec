-- ZiisTec V2 — remove assinaturas legadas de venda em campo.
-- A aplicação usa exclusivamente os contratos atuais, com contexto opcional seguro
-- na venda rápida e client_request_id também na venda em OS.

-- Legado: venda rápida sem client/local explícitos.
drop function if exists public.zt_sell_product_direct(uuid,uuid,numeric,text,text,uuid);

-- Legado: venda em OS sem client_request_id.
drop function if exists public.zt_sell_product_on_work_order(uuid,uuid,numeric,text);
