-- =====================================================================
-- ZiisTec · migration 0002 — Storage
-- Arquivos ficam em buckets PRIVADOS. O caminho começa sempre pelo
-- company_id, e a política confere esse primeiro segmento contra a
-- membresia do usuário. URL difícil de adivinhar não é proteção.
--   company_id/work-orders/<os_id>/foto.jpg
--   company_id/purchases/<compra_id>/boleto.pdf
--   company_id/branding/logo.png
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('zt-work-orders', 'zt-work-orders', false, 15728640,
   array['image/jpeg','image/png','image/webp','image/heic']),
  ('zt-documents',   'zt-documents',   false, 20971520,
   array['application/pdf','image/jpeg','image/png','image/webp']),
  -- SVG fica fora desta versão: é XML executável e um logo enviado por
  -- usuário poderia carregar script. Volta quando houver sanitização.
  ('zt-branding',    'zt-branding',    false,  2097152,
   array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- primeiro segmento do caminho = company_id
create or replace function public.zt_path_company(path text)
returns uuid language sql immutable as $$
  select nullif(split_part(path, '/', 1), '')::uuid;
$$;
grant execute on function public.zt_path_company(text) to authenticated;

-- ---------------------------------------------------------------------
-- fotos de OS: owner alcança as da empresa; técnico só as das OS dele
-- ---------------------------------------------------------------------
drop policy if exists zt_wo_files_read on storage.objects;
create policy zt_wo_files_read on storage.objects for select to authenticated using (
  bucket_id = 'zt-work-orders' and (
    public.zt_is_owner(public.zt_path_company(name))
    or (
      -- zt_is_member exige membresia ATIVA: desativou o colaborador, ele para
      -- de baixar foto antiga no mesmo instante
      public.zt_is_member(public.zt_path_company(name))
      and exists (
        select 1 from public.work_orders w
        where w.company_id = public.zt_path_company(name)
          and public.zt_wo_is_mine(w.id)
          and name like public.zt_path_company(name)::text || '/work-orders/' || w.id::text || '/%'
      )
    )
  )
);

drop policy if exists zt_wo_files_write on storage.objects;
create policy zt_wo_files_write on storage.objects for insert to authenticated with check (
  bucket_id = 'zt-work-orders' and (
    public.zt_is_owner(public.zt_path_company(name))
    or (
      public.zt_is_member(public.zt_path_company(name))
      and exists (
        select 1 from public.work_orders w
        where w.company_id = public.zt_path_company(name)
          and public.zt_wo_is_mine(w.id)
          and name like public.zt_path_company(name)::text || '/work-orders/' || w.id::text || '/%'
      )
    )
  )
);

drop policy if exists zt_wo_files_delete on storage.objects;
create policy zt_wo_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'zt-work-orders' and public.zt_is_owner(public.zt_path_company(name)));

-- ---------------------------------------------------------------------
-- documentos (boletos, notas, PDFs) e identidade visual: só o owner
-- ---------------------------------------------------------------------
drop policy if exists zt_docs_all on storage.objects;
create policy zt_docs_all on storage.objects for all to authenticated
  using (bucket_id = 'zt-documents' and public.zt_is_owner(public.zt_path_company(name)))
  with check (bucket_id = 'zt-documents' and public.zt_is_owner(public.zt_path_company(name)));

drop policy if exists zt_branding_read on storage.objects;
create policy zt_branding_read on storage.objects for select to authenticated
  using (bucket_id = 'zt-branding' and public.zt_is_member(public.zt_path_company(name)));
-- (zt_is_member já exige membresia ativa)

drop policy if exists zt_branding_write on storage.objects;
create policy zt_branding_write on storage.objects for all to authenticated
  using (bucket_id = 'zt-branding' and public.zt_is_owner(public.zt_path_company(name)))
  with check (bucket_id = 'zt-branding' and public.zt_is_owner(public.zt_path_company(name)));

-- Buckets privados: o app nunca usa URL pública. Para exibir uma foto,
-- pede uma signed URL de curta duração, que só é emitida se as políticas
-- acima autorizarem o usuário logado.
