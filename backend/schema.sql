-- RevRec AI — expected schema for the 3 tables the backend talks to.
-- Tables already exist in your Supabase project; this is idempotent so it's
-- safe to run in the Supabase SQL editor to make sure columns/types line up
-- with what backend/services and routes expect.

create extension if not exists pgcrypto;

create table if not exists payments (
    id uuid primary key default gen_random_uuid(),
    amount numeric not null,
    payment_method text not null,
    failure_reason text not null,
    customer_name text not null,
    customer_email text not null,
    customer_pattern text not null default 'occasional_failure',
    previous_attempts integer not null default 0,
    status text not null default 'failed', -- 'failed' | 'recovered'
    risk_score numeric,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists retry_predictions (
    id uuid primary key default gen_random_uuid(),
    payment_id uuid not null references payments(id) on delete cascade,
    probabilities jsonb not null, -- { retry_now, retry_15min, retry_1hr, retry_6hr, retry_tomorrow }
    recommended_window text not null,
    best_probability numeric not null,
    expected_recovery_value numeric not null,
    explanation text not null,
    risk_score numeric,
    created_at timestamptz not null default now()
);

create table if not exists payment_events (
    id uuid primary key default gen_random_uuid(),
    payment_id uuid not null references payments(id) on delete cascade,
    event_type text not null,
    metadata jsonb default '{}'::jsonb,
    created_at timestamptz not null default now()
);

-- Add any missing columns if the tables already existed with a different shape.
alter table payments add column if not exists risk_score numeric;
alter table payments add column if not exists updated_at timestamptz not null default now();
alter table retry_predictions add column if not exists risk_score numeric;
alter table payment_events add column if not exists metadata jsonb default '{}'::jsonb;

-- These 3 tables were created without Supabase's usual default grants, so both
-- the anon and service_role Postgres roles get "permission denied for table X"
-- (error 42501) even though RLS isn't the issue. Restore the standard grants:
grant usage on schema public to anon, authenticated, service_role;
grant all privileges on payments, retry_predictions, payment_events to service_role;
grant select, insert, update, delete on payments, retry_predictions, payment_events to authenticated;
-- The backend uses the service_role key (bypasses RLS), so anon doesn't need
-- write access. If you also want anon reads for some reason, uncomment:
-- grant select on payments, retry_predictions, payment_events to anon;
