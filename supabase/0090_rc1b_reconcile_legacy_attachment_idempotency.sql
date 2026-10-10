-- ZiisTec RC-1B — reconcile legacy work-order attachment idempotency.
-- Forward-only: 0089 established company + work order + media stage + SHA-256
-- as the canonical identity for work-order evidence.
-- Purchase attachment idempotency remains unchanged.

drop index if exists public.uq_attachments_wo_content;
