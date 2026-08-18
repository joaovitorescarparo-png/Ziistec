alter table public.work_orders add constraint work_orders_id_company_key unique (id, company_id);
alter table public.clients add constraint clients_id_company_key unique (id, company_id);
alter table public.quotes add constraint quotes_id_company_key unique (id, company_id);

alter table public.work_orders add constraint work_orders_client_company_fkey
foreign key (client_id, company_id) references public.clients(id, company_id) on delete restrict;
alter table public.work_orders add constraint work_orders_quote_company_fkey
foreign key (quote_id, company_id) references public.quotes(id, company_id);
alter table public.work_order_items add constraint wo_items_work_order_company_fkey
foreign key (work_order_id, company_id) references public.work_orders(id, company_id) on delete cascade;
alter table public.work_order_materials add constraint wo_materials_work_order_company_fkey
foreign key (work_order_id, company_id) references public.work_orders(id, company_id) on delete cascade;
alter table public.work_order_reports add constraint wo_reports_work_order_company_fkey
foreign key (work_order_id, company_id) references public.work_orders(id, company_id) on delete cascade;
alter table public.work_order_checklists add constraint wo_checklists_work_order_company_fkey
foreign key (work_order_id, company_id) references public.work_orders(id, company_id) on delete cascade;
alter table public.attachments add constraint attachments_work_order_company_fkey
foreign key (work_order_id, company_id) references public.work_orders(id, company_id) on delete cascade;
alter table public.warranties add constraint warranties_work_order_company_fkey
foreign key (work_order_id, company_id) references public.work_orders(id, company_id);
