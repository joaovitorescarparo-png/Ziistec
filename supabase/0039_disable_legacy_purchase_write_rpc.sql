-- O frontend usa apenas a escrita idempotente. Mantemos o wrapper legado fora da API autenticada.
revoke execute on function public.zt_save_purchase(uuid,uuid,jsonb,jsonb) from authenticated;
revoke execute on function public.zt_save_purchase(uuid,uuid,jsonb,jsonb) from anon;
revoke execute on function public.zt_save_purchase(uuid,uuid,jsonb,jsonb) from public;
