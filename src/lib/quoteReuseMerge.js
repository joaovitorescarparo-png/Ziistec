const num=(v,fallback=0)=>{const n=Number(v);return Number.isFinite(n)?n:fallback;};

export function emptyReuseSeed(defaults={}){
  return {
    sourceKind:'blank',sourceId:null,clientId:null,address:'',servicePlace:'',title:'',customerMessage:'',description:'',
    paymentTerms:defaults.paymentTerms||'',notes:defaults.notes||'',warrantyNote:'',validityDays:num(defaults.validityDays,15)||15,
    executionForecastDate:'',checklistTemplateId:null,items:[],discount:0,surcharge:0,showProductImages:false,
  };
}

export function normalizeReuseItem(item,index=0){
  return {
    reuseKey:item?.reuse_key||item?.reuseKey||`manual:${Date.now()}:${index}`,
    kind:item?.kind||'free',serviceId:item?.service_id||item?.serviceId||null,productId:item?.product_id||item?.productId||null,
    name:String(item?.name||'Item').slice(0,500),unit:String(item?.unit||'unidade').slice(0,50),quantity:Math.max(0.001,num(item?.quantity,1)),
    unitPrice:item?.unit_price===null||item?.unitPrice===null?null:num(item?.unit_price??item?.unitPrice,0),
    unitCost:item?.unit_cost===null||item?.unitCost===null?null:num(item?.unit_cost??item?.unitCost,0),notes:String(item?.notes||'').slice(0,1000),
    available:item?.available!==false,requiresPrice:Boolean(item?.requires_price??item?.requiresPrice),priceChanged:Boolean(item?.price_changed??item?.priceChanged),
    historicalUnitPrice:item?.historical_unit_price??item?.historicalUnitPrice??null,availabilityReason:item?.availability_reason||item?.availabilityReason||null,
  };
}

export function applyTemplateSeed(current,resolved){
  const base=current||emptyReuseSeed();
  return {...base,sourceKind:'template',sourceId:resolved?.source_id||null,title:resolved?.title??base.title,customerMessage:resolved?.customer_message??base.customerMessage,
    description:resolved?.description??base.description,paymentTerms:resolved?.payment_terms??base.paymentTerms,notes:resolved?.notes??base.notes,
    warrantyNote:resolved?.warranty_note??base.warrantyNote,validityDays:num(resolved?.validity_days,base.validityDays)||base.validityDays,
    executionForecastDate:resolved?.execution_forecast_date||base.executionForecastDate,checklistTemplateId:resolved?.checklist_template_id||null,
    items:(resolved?.items||[]).map(normalizeReuseItem)};
}

export function appendKitSeed(current,resolved){
  const base=current||emptyReuseSeed();
  const existing=(base.items||[]).map(normalizeReuseItem);
  const byKey=new Map(existing.map((item,index)=>[item.reuseKey,index]));
  const out=[...existing];
  for(const raw of resolved?.items||[]){
    const item=normalizeReuseItem(raw,out.length);
    const at=byKey.get(item.reuseKey);
    if(at===undefined){byKey.set(item.reuseKey,out.length);out.push(item);} else out[at]=item;
  }
  return {...base,sourceKind:base.sourceKind==='blank'?'kit':base.sourceKind,items:out};
}

export function seedFromWorkOrder(resolved,defaults={}){
  return {...emptyReuseSeed(defaults),sourceKind:'work_order',sourceId:resolved?.source_id||null,sourceNumber:resolved?.source_number||'',
    clientId:resolved?.client_id||null,address:resolved?.address||'',servicePlace:resolved?.service_place||'',description:resolved?.description||'',
    items:(resolved?.items||[]).map(normalizeReuseItem)};
}

export function hasBlockingReuseItems(seed){
  return (seed?.items||[]).some(item=>item.available===false||item.unitPrice===null||!Number.isFinite(Number(item.unitPrice))||Number(item.unitPrice)<0);
}
