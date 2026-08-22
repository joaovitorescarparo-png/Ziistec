create or replace function zt_private.subscription_can_write(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
      from public.subscriptions s
     where s.company_id = p_company
       and s.status in ('trial','active')
       and (s.current_period_end is null or s.current_period_end >= current_date)
  );
$$;

revoke all on function zt_private.subscription_can_write(uuid) from public, anon, authenticated;

create or replace function public.zt_subscription_can_write(target uuid)
returns boolean
language sql
stable
security definer
set search_path = zt_private
as $$ select zt_private.subscription_can_write(target); $$;

revoke all on function public.zt_subscription_can_write(uuid) from public, anon;
grant execute on function public.zt_subscription_can_write(uuid) to authenticated;

alter policy zt_branding_write on storage.objects
  using (
    bucket_id = 'zt-branding'
    and public.zt_is_owner(public.zt_path_company(name))
    and public.zt_subscription_can_write(public.zt_path_company(name))
  )
  with check (
    bucket_id = 'zt-branding'
    and public.zt_is_owner(public.zt_path_company(name))
    and public.zt_subscription_can_write(public.zt_path_company(name))
  );

alter policy zt_docs_all on storage.objects
  using (
    bucket_id = 'zt-documents'
    and public.zt_is_owner(public.zt_path_company(name))
    and public.zt_subscription_can_write(public.zt_path_company(name))
  )
  with check (
    bucket_id = 'zt-documents'
    and public.zt_is_owner(public.zt_path_company(name))
    and public.zt_subscription_can_write(public.zt_path_company(name))
  );

alter policy zt_wo_files_delete on storage.objects
  using (
    bucket_id = 'zt-work-orders'
    and public.zt_is_owner(public.zt_path_company(name))
    and public.zt_subscription_can_write(public.zt_path_company(name))
  );

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
             and storage.objects.name like (public.zt_path_company(storage.objects.name)::text || '/work-orders/' || w.id::text || '/%')
        )
      )
    )
  );
