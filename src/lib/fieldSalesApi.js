import { supabase } from './supabase';

const check = (r) => { if (r?.error) throw r.error; return r?.data; };

export async function venderProdutoDiretoDB({
  companyId,
  productId,
  quantity = 1,
  paymentMethod = 'Pix',
  notes = '',
  requestId = null,
}) {
  const req = requestId || crypto.randomUUID();
  const id = check(await supabase.rpc('zt_sell_product_direct', {
    p_company: companyId,
    p_product: productId,
    p_quantity: Number(quantity || 0),
    p_payment_method: paymentMethod,
    p_notes: notes || null,
    p_request: req,
  }));
  return { id, requestId:req };
}
