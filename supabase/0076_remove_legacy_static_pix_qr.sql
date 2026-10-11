-- ZiisTec V2 — remove o armazenamento legado de QR Pix estático.
-- O Pix agora é configurado por chave + recebedor + cidade e o QR é gerado
-- localmente no navegador com o valor exato da venda.

alter table public.companies
  drop column if exists pix_qr_path;
