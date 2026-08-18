create or replace function public.zt_update_team_member(
  p_company uuid,
  p_user uuid,
  p_name text default null,
  p_phone text default null,
  p_job_title text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Somente o proprietário pode editar a equipe' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.company_members
    where company_id = p_company and user_id = p_user and role = 'technician'
  ) then raise exception 'Colaborador não encontrado nesta empresa' using errcode = '42501'; end if;

  update public.profiles
     set full_name = coalesce(nullif(trim(p_name),''), full_name),
         phone = case when p_phone is null then phone else nullif(trim(p_phone),'') end
   where id = p_user;

  update public.company_members
     set job_title = nullif(trim(p_job_title),'')
   where company_id = p_company and user_id = p_user;
end $$;

revoke execute on function public.zt_update_team_member(uuid,uuid,text,text,text) from public, anon;
grant execute on function public.zt_update_team_member(uuid,uuid,text,text,text) to authenticated, service_role;
