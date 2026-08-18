-- Usuário comum pode editar somente campos seguros do próprio perfil.
revoke insert, update, delete on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name, phone, last_seen_at) on table public.profiles to authenticated;

-- Defesa adicional: mesmo se grants forem afrouxados no futuro, não permite
-- alteração de is_platform_admin por uma sessão comum.
create or replace function public.zt_guard_profile_privilege_fields()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.is_platform_admin,false) and current_user not in ('postgres','service_role') then
      raise exception 'Campo administrativo protegido' using errcode='42501';
    end if;
  elsif new.is_platform_admin is distinct from old.is_platform_admin then
    if current_user not in ('postgres','service_role') then
      raise exception 'Campo administrativo protegido' using errcode='42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists zt_guard_profile_privilege_fields on public.profiles;
create trigger zt_guard_profile_privilege_fields
before insert or update of is_platform_admin on public.profiles
for each row execute function public.zt_guard_profile_privilege_fields();

revoke execute on function public.zt_guard_profile_privilege_fields() from public, anon, authenticated;
