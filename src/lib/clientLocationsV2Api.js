import { supabase } from './supabase';

const check=(r)=>{if(r?.error) throw r.error;return r?.data;};
const trimOrNull=(v,max)=>{const s=String(v||'').trim();return s?s.slice(0,max):null;};
const finiteOrNull=(v)=>v==null||v===''?null:Number(v);

export function buildGoogleMapsUrl({address='',placeId='',latitude=null,longitude=null}={}){
  const lat=finiteOrNull(latitude);
  const lng=finiteOrNull(longitude);
  const pid=String(placeId||'').trim();
  const addr=String(address||'').trim();
  const query=Number.isFinite(lat)&&Number.isFinite(lng)?`${lat},${lng}`:addr;
  if(!query&&!pid) return null;
  const url=new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api','1');
  url.searchParams.set('query',query||pid);
  if(pid) url.searchParams.set('query_place_id',pid);
  return url.toString();
}

export function normalizeGoogleMapsUrl(value){
  const raw=String(value||'').trim();
  if(!raw) return null;
  let url;
  try{url=new URL(raw);}catch{return null;}
  if(url.protocol!=='https:') return null;
  const host=url.hostname.toLowerCase();
  const allowed=host==='google.com'||host==='www.google.com'||host==='maps.google.com'||host==='goo.gl'||host==='maps.app.goo.gl';
  return allowed?url.toString().slice(0,2000):null;
}

export async function carregarClientesLocaisV2DB(companyId){
  return check(await supabase.from('clients')
    .select('id,company_id,person_type,name,trade_name,contact_name,phone,whatsapp,address,notes,google_place_id,latitude,longitude,maps_url,created_at')
    .eq('company_id',companyId)
    .order('name',{ascending:true}))||[];
}

export async function salvarLocalClienteV2DB(client,location){
  if(!client?.id||!client?.company_id) throw new Error('Cliente inválido.');
  const latitude=finiteOrNull(location?.latitude);
  const longitude=finiteOrNull(location?.longitude);
  if(latitude!=null&&(!Number.isFinite(latitude)||latitude< -90||latitude>90)) throw new Error('Latitude inválida.');
  if(longitude!=null&&(!Number.isFinite(longitude)||longitude< -180||longitude>180)) throw new Error('Longitude inválida.');
  if((latitude==null)!==(longitude==null)) throw new Error('Informe latitude e longitude juntas.');

  const address=trimOrNull(location?.address,1000);
  const googlePlaceId=trimOrNull(location?.googlePlaceId,500);
  const pasted=normalizeGoogleMapsUrl(location?.mapsUrl);
  if(String(location?.mapsUrl||'').trim()&&!pasted) throw new Error('Use um link HTTPS válido do Google Maps.');
  const mapsUrl=pasted||buildGoogleMapsUrl({address,placeId:googlePlaceId,latitude,longitude});

  const row=check(await supabase.from('clients').update({
    address,
    google_place_id:googlePlaceId,
    latitude,
    longitude,
    maps_url:mapsUrl,
  }).eq('id',client.id).eq('company_id',client.company_id)
    .select('id,company_id,address,google_place_id,latitude,longitude,maps_url').single());
  return row;
}

export async function limparLocalClienteV2DB(client){
  if(!client?.id||!client?.company_id) throw new Error('Cliente inválido.');
  return check(await supabase.from('clients').update({address:null,google_place_id:null,latitude:null,longitude:null,maps_url:null})
    .eq('id',client.id).eq('company_id',client.company_id)
    .select('id,company_id,address,google_place_id,latitude,longitude,maps_url').single());
}
