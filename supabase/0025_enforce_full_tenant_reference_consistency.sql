alter table public.purchases add constraint purchases_id_company_key unique (id, company_id);
alter table public.products add constraint products_id_company_key unique (id, company_id);
alter table public.services add constraint services_id_company_key unique (id, company_id);

alter table public.quotes add constraint quotes_client_company_fkey
foreign key (client_id, company_id) references public.clients(id, company_id) on delete restrict;
alter table public.quote_items add constraint quote_items_quote_company_fkey
foreign key (quote_id, company_id) references public.quotes(id, company_id) on delete cascade;
alter table public.quote_items add constraint quote_items_service_company_fkey
foreign key (service_id, company_id) references public.services(id, company_id);
alter table public.quote_items add constraint quote_items_product_company_fkey
foreign key (product_id, company_id) references public.products(id, company_id);
alter table public.purchase_items add constraint purchase_items_purchase_company_fkey
foreign key (purchase_id, company_id) references public.purchases(id, company_id) on delete cascade;
alter table public.purchase_items add constraint purchase_items_product_company_fkey
foreign key (product_id, company_id) references public.products(id, company_id);
alter table public.attachments add constraint attachments_purchase_company_fkey
foreign key (purchase_id, company_id) references public.purchases(id, company_id) on delete cascade;
alter table public.financial_entries add constraint financial_client_company_fkey
foreign key (client_id, company_id) references public.clients(id, company_id);
alter table public.financial_entries add constraint financial_work_order_company_fkey
foreign key (work_order_id, company_id) references public.work_orders(id, company_id);
alter table public.financial_entries add constraint financial_purchase_company_fkey
foreign key (purchase_id, company_id) references public.purchases(id, company_id);
alter table public.warranties add constraint warranties_client_company_fkey
foreign key (client_id, company_id) references public.clients(id, company_id) on delete cascade;
alter table public.warranties add constraint warranties_service_company_fkey
foreign key (service_id, company_id) references public.services(id, company_id);
alter table public.warranties add constraint warranties_product_company_fkey
foreign key (product_id, company_id) references public.products(id, company_id);
alter table public.work_order_items add constraint wo_items_service_company_fkey
foreign key (service_id, company_id) references public.services(id, company_id);
alter table public.work_order_items add constraint wo_items_product_company_fkey
foreign key (product_id, company_id) references public.products(id, company_id);
alter table public.work_order_materials add constraint wo_materials_product_company_fkey
foreign key (product_id, company_id) references public.products(id, company_id);
