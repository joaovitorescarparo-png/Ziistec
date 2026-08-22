alter policy zt_wo_files_write on storage.objects
  with check (
    bucket_id = 'zt-work-orders'
    and public.zt_subscription_can_write(public.zt_path_company(name))
    and (
      public.zt_is_owner(public.zt_path_company(name))
      or (
        public.zt_is_member(public.zt_path_company(name))
        and exists (
          select 1 from public.work_orders w
           where w.company_id = public.zt_path_company(storage.objects.name)
             and public.zt_wo_is_mine(w.id)
             and public.zt_wo_open(w.id)
             and storage.objects.name like (public.zt_path_company(storage.objects.name)::text || '/work-orders/' || w.id::text || '/%')
        )
      )
    )
  );
