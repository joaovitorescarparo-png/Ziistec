# RC-1B — SECURITY DEFINER audit

Audit date: 2026-09-11. Source of truth: versioned migrations through `0088_field_workflow_wave4b_corrections.sql` plus the live Supabase Staging project `xadoktssibuuebzzjrhv` (`pg_proc`, `pg_namespace`, ACLs, ownership, `proconfig`, schema privileges and event triggers).

## Decision

The application has **116 application SECURITY DEFINER functions**: **69 in `public`** and **47 in `zt_private`**. The database has **119 including platform-managed SECURITY DEFINER functions** (`pgbouncer`: 1, `vault`: 2). No ZiisTec SECURITY DEFINER is executable by `anon`. No `zt_private` SECURITY DEFINER is executable by `authenticated`; browser roles do not have `USAGE` on `zt_private`. `anon`, `authenticated` and `service_role` do not have `CREATE` on schema `public`.

Every application SECURITY DEFINER has an explicit `search_path`. 61/69 public functions use `search_path=""`; 5 use `zt_private`; 2 auth trigger functions use `public`; `rls_auto_enable` uses `pg_catalog`. In `zt_private`, 28 use empty path and 19 use `public`. The 19 private functions with `search_path=public` were inspected: referenced application objects are schema-qualified, the schema is not CREATE-able by browser/service roles, and the functions are not exposed to `authenticated`. They remain SAFE; changing them only for cosmetic consistency would add release risk without removing an exploitable path.

Only one application definer contains dynamic `EXECUTE`: `public.rls_auto_enable()`. It is an event-trigger function owned by `postgres`, not executable by anon/authenticated, fixed to `search_path=pg_catalog`, triggered only after table creation, restricted to schema `public`, and executes `format(..., cmd.object_identity)` from `pg_event_trigger_ddl_commands()`. Classification: SAFE.

**0090 is not required.** No proven SECURITY DEFINER vulnerability was found, so RC-1B does not create an empty or cosmetic hardening migration.

## Classification rules

`SAFE` means: explicit search path; no anonymous EXECUTE; tenant/role checks are direct or delegated to a non-browser-accessible `zt_private` implementation; subscription guard is present where the operation is a protected write; no unsafe dynamic SQL; and no cross-tenant bypass was reproduced. Public wrappers remain SECURITY DEFINER when they intentionally bridge into `zt_private`; converting them mechanically to INVOKER would break the private-schema boundary. Trigger-only/internal functions have role/subscription marked contextual when they are not callable business RPCs.

Origins below identify the current feature migration when clear. `baseline/redefined` means the function has been created/replaced across the 0001–0080 hardening chain, so a single original migration is not authoritative for its current definition. Field workflow origins: service report `0082`; installed equipment `0083`; checklist/return `0084`; templates/kits/reuse `0085`; client locations `0086`; global search/post-sale `0087/0088`; field sales `0072–0079`.

## Complete application inventory

Columns: `schema | signature | origin | EXECUTE | search_path | auth.uid | company/membership/role | subscription | dynamic SQL | classification`.

### public (69)

All rows below were read from Staging. `delegated` means the public wrapper calls a reviewed `zt_private` implementation. Unless noted, owner is `postgres`.

| signature | origin | EXECUTE | search_path | auth | tenant/role | subscription | dynamic | class |
|---|---|---|---|---|---|---|---|---|
| `rls_auto_enable()` | baseline | service_role/event trigger | `pg_catalog` | trigger | schema-scoped | n/a | safe identifier format | SAFE |
| `zt_accept_invites()` | 0080/redefined | authenticated, service_role | `""` | delegated | delegated | contextual | no | SAFE |
| `zt_adjust_product_stock(p_company uuid, p_product uuid, p_delta numeric, p_notes text)` | 0051+ | authenticated, service_role | `""` | direct | owner/company | protected write | no | SAFE |
| `zt_apply_checklist_template(p_wo uuid, p_template uuid)` | 0084 | authenticated, service_role | `""` | direct | OS/company/role | protected write | no | SAFE |
| `zt_bill_work_order(p_wo uuid, p_due_days integer)` | baseline/redefined | service_role | `zt_private` | delegated | delegated | protected write | no | SAFE |
| `zt_cancel_subscription(p_company uuid)` | baseline/redefined | authenticated, service_role | `""` | delegated | owner/company | subscription operation | no | SAFE |
| `zt_client_visible(c_id uuid, comp uuid)` | hardening baseline | authenticated, service_role | `""` | delegated | membership/company | contextual | no | SAFE |
| `zt_compartilha_empresa(outro uuid)` | hardening baseline | authenticated, service_role | `""` | delegated | membership/company | contextual | no | SAFE |
| `zt_complete_work_order(p_wo uuid, p_report text, p_pending text, p_extra_cost numeric, p_due_days integer)` | legacy compatibility | service_role | `""` | delegated | delegated | protected write | no | SAFE |
| `zt_consume_ai_quota(p_company uuid)` | baseline/redefined | authenticated, service_role | `""` | delegated | owner/company | protected quota | no | SAFE |
| `zt_consume_quote_pdf_quota(p_company uuid)` | baseline/redefined | authenticated, service_role | `""` | delegated | owner/company | protected quota | no | SAFE |
| `zt_create_client_location_for_quote(p_client uuid, p_name text, p_address text)` | 0086 | authenticated, service_role | `""` | direct | owner/company/client | protected write | no | SAFE |
| `zt_create_company(p_name text, p_activity text, p_has_team boolean, p_owner_name text, p_phone text)` | baseline/redefined | authenticated, service_role | `""` | delegated | authenticated creator | bootstrap subscription | no | SAFE |
| `zt_create_manual_warranty(p_company uuid, p_client uuid, p_kind text, p_description text, p_starts_on date, p_ends_on date, p_service_place text, p_service uuid, p_product uuid, p_serial text, p_notes text)` | 0051+ | authenticated, service_role | `""` | direct | owner/company | protected write | no | SAFE |
| `zt_create_work_order_from_quote(p_quote uuid, p_assigned_to uuid, p_scheduled_date date, p_scheduled_time time)` | 0057+ | authenticated, service_role | `""` | direct | owner/company/assignee | protected write | no | SAFE |
| `zt_finalize_pending_work_order_pricing(p_wo uuid, p_due_days integer)` | 0060+ | service_role | `""` | direct/internal | company | protected write | no | SAFE |
| `zt_finalize_work_order_atomic(p_wo uuid, p_report text, p_pending text, p_extra_cost numeric, p_due_days integer, p_materials jsonb, p_additions jsonb)` | 0050–0060/redefined | authenticated, service_role | `""` | delegated | OS/company/role | protected write | no | SAFE |
| `zt_finalize_work_order_with_warranty_overrides(p_wo uuid, p_report text, p_pending text, p_extra_cost numeric, p_due_days integer, p_materials jsonb, p_additions jsonb, p_warranty_overrides jsonb)` | 0063–0069 | authenticated, service_role | `""` | delegated | OS/company/role | protected write | no | SAFE |
| `zt_generate_maintenance_contract_cycle(p_contract uuid, p_cycle date, p_service_on date, p_due_on date)` | 0052+ | authenticated, service_role | `""` | direct | owner/company | protected write | no | SAFE |
| `zt_global_operational_search(p_company uuid, p_query text, p_limit integer, p_offset integer)` | 0087 | authenticated, service_role | `""` | direct | owner/company | read | no | SAFE |
| `zt_guard_subscription_write()` | hardening baseline | service_role/trigger | `""` | delegated | contextual | direct guard | no | SAFE |
| `zt_handle_new_user()` | baseline auth trigger | service_role/trigger | `public` | trigger | auth-user scoped | n/a | no | SAFE |
| `zt_installed_equipment_history(p_client uuid)` | 0083 | authenticated, service_role | `""` | direct | company/role | read | no | SAFE |
| `zt_is_member(target uuid)` | hardening baseline | authenticated, service_role | `""` | delegated | membership/company | contextual | no | SAFE |
| `zt_is_owner(target uuid)` | hardening baseline | authenticated, service_role | `""` | delegated | owner/company | contextual | no | SAFE |
| `zt_is_platform_admin()` | hardening baseline | authenticated, service_role | `""` | delegated | platform admin | contextual | no | SAFE |
| `zt_list_client_locations_for_quote(p_client uuid)` | 0086 | authenticated, service_role | `""` | delegated | owner/company/client | read | no | SAFE |
| `zt_list_post_sale_followups(p_company uuid, p_scope text, p_limit integer, p_offset integer)` | 0087 | authenticated, service_role | `""` | direct | owner/company | read | no | SAFE |
| `zt_list_post_sale_policies(p_company uuid)` | 0087 | authenticated, service_role | `""` | direct | owner/company | read | no | SAFE |
| `zt_list_quote_kits(p_company uuid)` | 0085 | authenticated, service_role | `""` | delegated | owner/company | read | no | SAFE |
| `zt_list_quote_templates(p_company uuid)` | 0085 | authenticated, service_role | `""` | delegated | owner/company | read | no | SAFE |
| `zt_list_reusable_work_orders(p_company uuid)` | 0085 | authenticated, service_role | `""` | delegated | owner/company | read | no | SAFE |
| `zt_mark_work_order_needs_return(p_wo uuid, p_reason text, p_material_needed text, p_notes text, p_priority text, p_expected_return_date date, p_request_id uuid)` | 0084 | authenticated, service_role | `""` | direct | OS/company/assigned role | protected write | no | SAFE |
| `zt_next_number(comp uuid, doc text, prefix text)` | baseline/redefined | service_role | `zt_private` | delegated | company | protected write | no | SAFE |
| `zt_platform_set_subscription_status(p_company uuid, p_status zt_sub_status)` | baseline/redefined | authenticated, service_role | `""` | delegated | platform-admin guard | subscription admin | no | SAFE |
| `zt_quote_seed_from_work_order(p_work_order uuid)` | 0085 | authenticated, service_role | `""` | delegated | owner/company | read | no | SAFE |
| `zt_reactivate_subscription(p_company uuid)` | baseline/redefined | authenticated, service_role | `""` | delegated | owner/company | subscription operation | no | SAFE |
| `zt_refresh_subscription_status(p_company uuid)` | baseline/redefined | authenticated, service_role | `""` | delegated | owner/company | subscription operation | no | SAFE |
| `zt_register_installed_equipment(p_wo uuid, p_source_material uuid, p_source_item uuid, p_location_name text, p_location_id uuid, p_serial text, p_barcode text, p_notes text, p_image_attachment uuid)` | 0083 | authenticated, service_role | `""` | direct | OS/company/role | protected write | no | SAFE |
| `zt_resolve_quote_kit(p_kit uuid)` | 0085 | authenticated, service_role | `""` | delegated | owner/company | read | no | SAFE |
| `zt_resolve_quote_template(p_template uuid)` | 0085 | authenticated, service_role | `""` | delegated | owner/company | read | no | SAFE |
| `zt_resolve_work_order_pricing(p_wo uuid, p_prices jsonb, p_due_days integer)` | 0060+ | authenticated, service_role | `""` | direct | owner/company | protected write | no | SAFE |
| `zt_save_checklist_template(p_company uuid, p_template uuid, p_name text, p_description text, p_active boolean, p_items jsonb)` | 0084 | authenticated, service_role | `""` | direct | owner/company | protected write | no | SAFE |
| `zt_save_manual_financial_entry(p_company uuid, p_entry uuid, p_request uuid, p_row jsonb)` | baseline/redefined | authenticated, service_role | `""` | delegated | owner/company | protected write | no | SAFE |
| `zt_save_post_sale_policy(p_company uuid, p_policy uuid, p_name text, p_kind text, p_days_offset integer, p_enabled boolean)` | 0087 | authenticated, service_role | `""` | direct | owner/company | protected write | no | SAFE |
| `zt_save_purchase(p_company uuid, p_purchase uuid, p_row jsonb, p_items jsonb)` | baseline/redefined | service_role | `zt_private` | delegated | owner/company | protected write | no | SAFE |
| `zt_save_purchase_idempotent(p_company uuid, p_purchase uuid, p_request uuid, p_row jsonb, p_items jsonb)` | 0035+ | authenticated, service_role | `""` | delegated | owner/company | protected write | no | SAFE |
| `zt_save_quote(p_company uuid, p_quote uuid, p_row jsonb, p_items jsonb)` | baseline/redefined | service_role | `zt_private` | delegated | owner/company | protected write | no | SAFE |
| `zt_save_quote_from_work_order_idempotent(p_work_order uuid, p_location uuid, p_request uuid, p_row jsonb, p_items jsonb)` | 0085/0086 | authenticated, service_role | `""` | delegated | owner/company | protected write | no | SAFE |
| `zt_save_quote_idempotent(p_company uuid, p_quote uuid, p_request uuid, p_row jsonb, p_items jsonb)` | 0035+ | authenticated, service_role | `""` | delegated | owner/company | protected write | no | SAFE |
| `zt_save_quote_kit(p_company uuid, p_kit uuid, p_payload jsonb, p_items jsonb)` | 0085 | authenticated, service_role | `""` | direct | owner/company | protected write | no | SAFE |
| `zt_save_quote_template(p_company uuid, p_template uuid, p_payload jsonb, p_items jsonb)` | 0085 | authenticated, service_role | `""` | direct | owner/company | protected write | no | SAFE |
| `zt_save_reuse_quote_idempotent(p_company uuid, p_quote uuid, p_request uuid, p_row jsonb, p_items jsonb)` | 0085 | authenticated, service_role | `""` | delegated | owner/company | protected write | no | SAFE |
| `zt_save_work_order(p_company uuid, p_wo uuid, p_row jsonb, p_items jsonb)` | baseline/redefined | service_role | `zt_private` | delegated | owner/company | protected write | no | SAFE |
| `zt_save_work_order_idempotent(p_company uuid, p_wo uuid, p_request uuid, p_row jsonb, p_items jsonb)` | 0035+/0067 | authenticated, service_role | `""` | delegated | owner/company/assignee | protected write | no | SAFE |
| `zt_sell_product_direct(p_company uuid, p_product uuid, p_quantity numeric, p_payment_method text, p_notes text, p_request uuid, p_client uuid, p_service_place text)` | 0072–0079 | authenticated, service_role | `""` | direct | member/company/role | protected write | no | SAFE |
| `zt_sell_product_on_work_order(p_wo uuid, p_product uuid, p_quantity numeric, p_notes text, p_request uuid)` | 0072–0079 | authenticated, service_role | `""` | direct | assigned OS/company | protected write | no | SAFE |
| `zt_set_financial_paid(p_entry uuid, p_paid boolean, p_method text)` | financial baseline | authenticated, service_role | `""` | delegated guard | owner/company | protected write | no | SAFE |
| `zt_set_followup_status(p_followup uuid, p_status text)` | baseline/redefined | authenticated, service_role | `""` | delegated | owner/company | protected write | no | SAFE |
| `zt_set_service_report_evidence(p_attachment uuid, p_include boolean)` | 0082 | authenticated, service_role | `""` | direct | OS/company/role | protected write | no | SAFE |
| `zt_set_work_order_warranty_overrides(p_wo uuid, p_overrides jsonb)` | 0063+ | authenticated, service_role | `""` | delegated | owner/company | protected write | no | SAFE |
| `zt_subscription_can_write(target uuid)` | hardening baseline | authenticated, service_role | `""` | delegated | membership/company | direct subscription check | no | SAFE |
| `zt_sync_profile_auth_email()` | 0080/auth trigger | service_role/trigger | `public` | trigger | auth-user scoped | n/a | no | SAFE |
| `zt_technician_catalog(p_company uuid)` | 0072+ | authenticated, service_role | `""` | direct | member/company | read | no | SAFE |
| `zt_update_post_sale_followup(p_followup uuid, p_status text, p_scheduled_for date, p_note text)` | 0087/0088 | authenticated, service_role | `""` | delegated | owner/company | protected write | no | SAFE |
| `zt_update_team_member(p_company uuid, p_user uuid, p_name text, p_phone text, p_job_title text)` | baseline/redefined | authenticated, service_role | `""` | delegated | owner/company | protected write | no | SAFE |
| `zt_wo_is_mine(w_id uuid)` | hardening baseline | authenticated, service_role | `""` | delegated | assigned OS/company | contextual | no | SAFE |
| `zt_wo_is_owned(w_id uuid)` | hardening baseline | authenticated, service_role | `""` | delegated | owner/company | contextual | no | SAFE |
| `zt_wo_open(w_id uuid)` | hardening baseline | authenticated, service_role | `""` | delegated | OS/company | contextual | no | SAFE |

### zt_private (47)

All functions below are owned by `postgres`, `service_role`-only at function ACL level, and the schema itself is not usable by `anon` or `authenticated`. Public wrappers/triggers are the controlled entry points.

| signature | origin | search_path | auth/tenant/role/subscription | dynamic | class |
|---|---|---|---|---|---|
| `assert_operational_write_allowed(p_company uuid)` | baseline/redefined | `public` | auth + membership + subscription | no | SAFE |
| `client_visible(c_id uuid, comp uuid)` | 0020+ | `""` | auth + membership | no | SAFE |
| `compartilha_empresa(outro uuid)` | 0020+ | `""` | auth + membership | no | SAFE |
| `is_member(target uuid)` | 0020+ | `""` | auth + membership | no | SAFE |
| `is_owner(target uuid)` | 0020+ | `""` | auth + owner | no | SAFE |
| `is_platform_admin()` | hardening baseline | `""` | auth + platform-admin | no | SAFE |
| `subscription_can_write(p_company uuid)` | hardening baseline | `""` | delegated membership/subscription | no | SAFE |
| `wo_is_mine(w_id uuid)` | 0020+ | `""` | auth + assigned membership | no | SAFE |
| `wo_is_owned(w_id uuid)` | 0020+ | `""` | auth + owner membership | no | SAFE |
| `wo_open(w_id uuid)` | 0020+ | `""` | auth + work-order context | no | SAFE |
| `zt_accept_invites()` | 0080/redefined | `public` | auth + confirmed identity/invite | no | SAFE |
| `zt_apply_work_order_warranty_overrides(p_wo uuid, p_overrides jsonb)` | 0063+ | `""` | auth + owner/company + subscription | no | SAFE |
| `zt_assert_wave4a_owner(p_company uuid, p_write boolean)` | 0085 | `""` | auth + owner/company + optional subscription | no | SAFE |
| `zt_bill_work_order(p_wo uuid, p_due_days integer)` | baseline/redefined | `""` | auth/company + subscription | no | SAFE |
| `zt_cancel_subscription(p_company uuid)` | baseline/redefined | `public` | auth + owner/company | no | SAFE |
| `zt_capture_approved_quote_snapshot()` | 0068 | `""` | trigger-context | no | SAFE |
| `zt_complete_work_order(p_wo uuid, p_report text, p_pending text, p_extra_cost numeric, p_due_days integer)` | compatibility | `""` | auth/company/role + subscription | no | SAFE |
| `zt_consume_ai_quota(p_company uuid)` | baseline/redefined | `public` | auth + owner/company + subscription/quota | no | SAFE |
| `zt_consume_quote_pdf_quota(p_company uuid)` | baseline/redefined | `public` | auth + owner/company + subscription/quota | no | SAFE |
| `zt_create_company(p_name text, p_activity text, p_has_team boolean, p_owner_name text, p_phone text)` | baseline/redefined | `public` | auth creator + membership bootstrap | no | SAFE |
| `zt_create_initial_service_report(p_wo uuid)` | 0082 | `""` | OS/company context | no | SAFE |
| `zt_finalize_work_order_atomic(p_wo uuid, p_report text, p_pending text, p_extra_cost numeric, p_due_days integer, p_materials jsonb, p_additions jsonb)` | 0050–0060 | `""` | auth + OS/company/role + subscription | no | SAFE |
| `zt_finalize_work_order_with_warranty_overrides(p_wo uuid, p_report text, p_pending text, p_extra_cost numeric, p_due_days integer, p_materials jsonb, p_additions jsonb, p_warranty_overrides jsonb)` | 0063–0069 | `""` | auth + OS/company/role + subscription | no | SAFE |
| `zt_generate_post_sale_followups()` | 0087 | `""` | trigger-context | no | SAFE |
| `zt_generate_warranty_post_sale_followups()` | 0087 | `""` | trigger-context | no | SAFE |
| `zt_guard_quote_checklist_template()` | 0085 | `""` | trigger-context | no | SAFE |
| `zt_insert_reuse_items(p_company uuid, p_parent uuid, p_kind text, p_items jsonb)` | 0085 | `""` | internal caller context | no | SAFE |
| `zt_manage_post_sale_followup(p_followup uuid, p_status text, p_scheduled_for date, p_note text)` | 0087/0088 | `""` | auth + owner/company + subscription | no | SAFE |
| `zt_next_number(comp uuid, doc text, prefix text)` | baseline/redefined | `public` | auth/company | no | SAFE |
| `zt_platform_set_subscription_status(p_company uuid, p_status zt_sub_status)` | baseline/redefined | `public` | auth + platform-admin | no | SAFE |
| `zt_prevent_warranty_renewal_from_warranty_visit()` | 0063+ | `public` | trigger-context | no | SAFE |
| `zt_reactivate_subscription(p_company uuid)` | baseline/redefined | `public` | auth + owner/company | no | SAFE |
| `zt_refresh_subscription_status(p_company uuid)` | baseline/redefined | `public` | auth + owner/company | no | SAFE |
| `zt_resolved_reuse_items(p_company uuid, p_parent uuid, p_kind text)` | 0085 | `""` | internal owner-scoped caller | no | SAFE |
| `zt_save_manual_financial_entry(p_company uuid, p_entry uuid, p_request uuid, p_row jsonb)` | financial hardening | `public` | auth + owner/company + subscription | no | SAFE |
| `zt_save_purchase(p_company uuid, p_purchase uuid, p_row jsonb, p_items jsonb)` | baseline/redefined | `""` | auth + owner/company + subscription | no | SAFE |
| `zt_save_purchase_idempotent(p_company uuid, p_purchase uuid, p_request uuid, p_row jsonb, p_items jsonb)` | 0035+ | `public` | delegated to guarded save | no | SAFE |
| `zt_save_quote(p_company uuid, p_quote uuid, p_row jsonb, p_items jsonb)` | baseline/redefined | `public` | auth + owner/company + subscription | no | SAFE |
| `zt_save_quote_idempotent(p_company uuid, p_quote uuid, p_request uuid, p_row jsonb, p_items jsonb)` | 0035+ | `public` | delegated to guarded save | no | SAFE |
| `zt_save_work_order(p_company uuid, p_wo uuid, p_row jsonb, p_items jsonb)` | baseline/redefined/0067 | `public` | auth + owner/company/assignee + subscription | no | SAFE |
| `zt_save_work_order_idempotent(p_company uuid, p_wo uuid, p_request uuid, p_row jsonb, p_items jsonb)` | 0035+/0067 | `public` | delegated to guarded save | no | SAFE |
| `zt_service_report_after_done()` | 0082 | `""` | trigger-context + OS/company | no | SAFE |
| `zt_set_followup_status(p_followup uuid, p_status text)` | baseline/redefined | `""` | auth + owner/company + subscription | no | SAFE |
| `zt_update_team_member(p_company uuid, p_user uuid, p_name text, p_phone text, p_job_title text)` | baseline/redefined | `public` | auth + owner/company + subscription | no | SAFE |
| `zt_validate_warranty_visit_linkage()` | 0063+ | `public` | trigger-context | no | SAFE |
| `zt_wave3b_before_work_order_done()` | 0084 | `""` | trigger-context + OS/company | no | SAFE |
| `zt_work_order_billable_total(p_wo uuid)` | field-sales/finalization | `""` | internal OS context | no | SAFE |

## Platform-managed inventory (3)

These are not defined by ZiisTec migrations and are classified separately, not counted in the 116 application functions.

- `pgbouncer.get_auth(...)`: Supabase platform-managed; restricted administrative role; explicit safe path; SAFE / PLATFORM-MANAGED.
- `vault.create_secret(...)`: Supabase Vault; service/admin execution, schema path `vault`; SAFE / PLATFORM-MANAGED.
- `vault.update_secret(...)`: Supabase Vault; service/admin execution, schema path `vault`; SAFE / PLATFORM-MANAGED.

## Regression evidence

`supabase/tests/v2_rc1b_security_definer_audit_rollback.sql` fails if the app inventory drifts from 116 without review, if any app definer gains anon EXECUTE, if a definer loses explicit search_path, if authenticated gains EXECUTE in `zt_private`, if browser/service roles gain CREATE on `public`, or if unexpected dynamic SQL appears. It also exercises owner A, tech A, owner B, tech B, no-membership, disabled membership, inactive subscription and anon against a representative owner-only privileged RPC.

No function was changed to SECURITY INVOKER during the audit. The new RC-1B evidence-registration RPC is deliberately **SECURITY INVOKER**, because existing `attachments` RLS + subscription trigger must remain the final authority.
