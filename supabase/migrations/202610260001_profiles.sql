create table if not exists public.profiles (
    id text primary key
        check (char_length(id) between 1 and 128),
    display_name text not null default 'Player'
        check (
            char_length(btrim(display_name)) between 1 and 32
            and display_name !~ '[[:cntrl:]]'
        ),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create or replace function public.profiles_set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
    before update on public.profiles
    for each row
    execute function public.profiles_set_updated_at();

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant all on table public.profiles to service_role;
