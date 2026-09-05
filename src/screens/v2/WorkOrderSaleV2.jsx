import React,{useEffect,useState} from 'react';
import TechnicianSalesV2 from './TechnicianSalesV2';
import FieldSalesAdminV2 from './FieldSalesAdminV2';
import { supabase } from '../../lib/supabase';

export default function WorkOrderSaleV2(props) {
  const [owner,setOwner]=useState(null);
  const voltarAoApp = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('v2');
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  };

  useEffect(()=>{
    let alive=true;
    (async()=>{
      const {data:{user}}=await supabase.auth.getUser();
      if(!user){if(alive)setOwner(false);return;}
      const r=await supabase.from('company_members').select('role,status').eq('company_id',props.companyId).eq('user_id',user.id).maybeSingle();
      if(alive)setOwner(!r.error&&r.data?.role==='owner'&&r.data?.status==='active');
    })();
    return()=>{alive=false;};
  },[props.companyId]);

  if(owner===null)return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">Abrindo vendas...</div>;
  if(owner)return <FieldSalesAdminV2 {...props} onClose={voltarAoApp}/>;
  return <TechnicianSalesV2 {...props} onClose={voltarAoApp} />;
}
