alter table public.quotes add constraint quotes_validity_after_issue
check (valid_until is null or valid_until >= issue_date);
alter table public.warranties add constraint warranties_end_after_start
check (ends_on >= starts_on);
alter table public.subscriptions add constraint subscriptions_period_order
check (current_period_start is null or current_period_end is null or current_period_end >= current_period_start);
alter table public.financial_entries add constraint financial_paid_state_consistency
check ((paid = false and paid_at is null) or (paid = true and paid_at is not null));
