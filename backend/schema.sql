
create table if not exists public.issues (
    id uuid primary key default gen_random_uuid(),
    report_code text unique not null,
    tracking_code_hash text not null,
    title text not null,
    category text not null,
    location text not null,
    description text not null,
    email text,
    status text not null default 'Pending'
        check (status in ('Pending', 'In Progress', 'Resolved', 'Rejected')),
    team_name text,
    resolution_note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Enable row-level security.
alter table public.issues enable row level security;

-- Do not add public read/write policies.
-- The backend uses the Supabase service-role key.
