-- Handles are allocated on demand by profiles_ensure_handle, so existing profile
-- rows can be upgraded without a bulk scan or exposing Firebase IDs.
alter table public.profiles
    add column if not exists handle text,
    add column if not exists handle_changed_at timestamptz;

update public.profiles
set display_name = case
    when char_length(regexp_replace(btrim(display_name), '[[:cntrl:]]', '', 'g')) < 2
        then 'Player'
    else left(regexp_replace(btrim(display_name), '[[:cntrl:]]', '', 'g'), 20)
end
where char_length(btrim(display_name)) < 2
   or char_length(btrim(display_name)) > 20
   or display_name ~ '[[:cntrl:]]';

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.profiles'::regclass
          and conname = 'profiles_display_name_phase2_check'
    ) then
        alter table public.profiles
            add constraint profiles_display_name_phase2_check
            check (
                char_length(btrim(display_name)) between 2 and 20
                and display_name !~ '[[:cntrl:]]'
            );
    end if;
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.profiles'::regclass
          and conname = 'profiles_handle_format_check'
    ) then
        alter table public.profiles
            add constraint profiles_handle_format_check
            check (handle is null or handle ~ '^[a-z0-9]{3,20}$');
    end if;
end;
$$;

create unique index if not exists profiles_handle_unique_idx
    on public.profiles (handle)
    where handle is not null;

create table if not exists public.friend_requests (
    id uuid primary key default gen_random_uuid(),
    requester_id text not null references public.profiles(id) on delete cascade,
    recipient_id text not null references public.profiles(id) on delete cascade,
    status text not null default 'pending'
        check (status in ('pending', 'accepted', 'declined', 'cancelled')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (requester_id <> recipient_id)
);

create table if not exists public.friendships (
    user_low text not null references public.profiles(id) on delete cascade,
    user_high text not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_low, user_high),
    check (user_low < user_high)
);

create unique index if not exists friend_requests_one_pending_per_pair_idx
    on public.friend_requests (
        (least(requester_id, recipient_id)),
        (greatest(requester_id, recipient_id))
    )
    where status = 'pending';
create index if not exists friend_requests_incoming_idx
    on public.friend_requests (recipient_id, created_at desc)
    where status = 'pending';
create index if not exists friend_requests_outgoing_idx
    on public.friend_requests (requester_id, created_at desc)
    where status = 'pending';

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.friend_requests, public.friendships from anon, authenticated;
grant all on table public.profiles, public.friend_requests, public.friendships to service_role;

create or replace function public.profiles_ensure_handle(p_account_id text)
returns table (
    display_name text,
    handle text,
    handle_changed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_profile public.profiles%rowtype;
    v_base text;
    v_candidate text;
begin
    select p.* into v_profile
    from public.profiles p
    where p.id = p_account_id
    for update;

    if not found then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
    end if;

    if v_profile.handle is null then
        v_base := left(regexp_replace(lower(v_profile.display_name), '[^a-z0-9]', '', 'g'), 15);
        if char_length(v_base) < 3 then
            v_base := 'player';
        end if;

        loop
            v_candidate := left(v_base, 15)
                || substr(md5(p_account_id || random()::text || clock_timestamp()::text), 1, 5);
            begin
                update public.profiles p
                set handle = v_candidate
                where p.id = p_account_id
                returning p.* into v_profile;
                exit;
            exception when unique_violation then
                -- A concurrent allocator won the candidate; retry under the unique index.
                null;
            end;
        end loop;
    end if;

    return query select v_profile.display_name, v_profile.handle, v_profile.handle_changed_at;
end;
$$;

create or replace function public.profiles_change_handle(p_account_id text, p_handle text)
returns table (
    display_name text,
    handle text,
    handle_changed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_profile public.profiles%rowtype;
begin
    if p_account_id is null or p_account_id = '' then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
    end if;
    insert into public.profiles (id, display_name)
    values (p_account_id, 'Player')
    on conflict (id) do nothing;

    if p_handle is null or p_handle !~ '^[a-z0-9]{3,20}$' then
        raise exception using errcode = 'P0001', message = 'INVALID_HANDLE';
    end if;

    select p.* into v_profile
    from public.profiles p
    where p.id = p_account_id
    for update;
    if not found then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
    end if;
    if v_profile.handle = p_handle then
        raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    if v_profile.handle_changed_at is not null
       and v_profile.handle_changed_at > now() - interval '7 days' then
        raise exception using errcode = 'P0001', message = 'HANDLE_COOLDOWN';
    end if;

    begin
        update public.profiles p
        set handle = p_handle, handle_changed_at = now()
        where p.id = p_account_id
        returning p.* into v_profile;
    exception when unique_violation then
        raise exception using errcode = 'P0001', message = 'HANDLE_COLLISION';
    end;

    return query select v_profile.display_name, v_profile.handle, v_profile.handle_changed_at;
end;
$$;

create or replace function public.profiles_search_public(
    p_account_id text,
    p_mode text,
    p_query text
)
returns table (display_name text, handle text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_profile_id text;
begin
    if p_mode is null or p_mode not in ('handle', 'displayName') or p_query is null
       or char_length(p_query) < 2 or char_length(p_query) > 20 then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
    end if;

    if p_mode = 'handle' and p_query !~ '^[a-z0-9]{3,20}$' then
        raise exception using errcode = 'P0001', message = 'INVALID_HANDLE';
    end if;
    if p_mode = 'displayName' and p_query ~ '[[:cntrl:]]' then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
    end if;

    for v_profile_id in
        select p.id
        from public.profiles p
        where p.id <> p_account_id
          and (p_mode = 'handle' and p.handle = p_query
               or p_mode = 'displayName' and position(lower(p_query) in lower(p.display_name)) > 0)
        order by p.display_name
        limit 20
    loop
        perform public.profiles_ensure_handle(v_profile_id);
    end loop;

    return query
    select p.display_name, p.handle
    from public.profiles p
    where p.id <> p_account_id
      and p.handle is not null
      and (p_mode = 'handle' and p.handle = p_query
           or p_mode = 'displayName' and position(lower(p_query) in lower(p.display_name)) > 0)
    order by p.display_name
    limit 20;
end;
$$;

create or replace function public.profiles_get_public(p_account_id text, p_handle text)
returns table (display_name text, handle text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_profile_id text;
begin
    if p_handle is null or p_handle !~ '^[a-z0-9]{3,20}$' then
        raise exception using errcode = 'P0001', message = 'INVALID_HANDLE';
    end if;
    select p.id into v_profile_id
    from public.profiles p
    where p.handle = p_handle and p.id <> p_account_id;
    if not found then
        return;
    end if;

    perform public.profiles_ensure_handle(v_profile_id);
    return query
    select p.display_name, p.handle
    from public.profiles p
    where p.id = v_profile_id and p.id <> p_account_id;
end;
$$;

create or replace function public.profiles_send_friend_request(p_account_id text, p_handle text)
returns table (request_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_recipient_id text;
    v_low text;
    v_high text;
    v_request_id uuid;
begin
    if p_account_id is null or p_account_id = '' then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
    end if;
    insert into public.profiles (id, display_name)
    values (p_account_id, 'Player')
    on conflict (id) do nothing;

    if p_handle is null or p_handle !~ '^[a-z0-9]{3,20}$' then
        raise exception using errcode = 'P0001', message = 'INVALID_HANDLE';
    end if;
    select p.id into v_recipient_id
    from public.profiles p
    where p.handle = p_handle;
    if not found or v_recipient_id = p_account_id then
        raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;

    v_low := least(p_account_id, v_recipient_id);
    v_high := greatest(p_account_id, v_recipient_id);
    perform pg_advisory_xact_lock(hashtextextended(v_low || ':' || v_high, 0));

    if exists (
        select 1 from public.friendships f
        where f.user_low = v_low and f.user_high = v_high
    ) or exists (
        select 1 from public.friend_requests r
        where least(r.requester_id, r.recipient_id) = v_low
          and greatest(r.requester_id, r.recipient_id) = v_high
          and r.status = 'pending'
    ) then
        raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;

    insert into public.friend_requests (requester_id, recipient_id)
    values (p_account_id, v_recipient_id)
    returning id into v_request_id;
    return query select v_request_id;
exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
end;
$$;

create or replace function public.profiles_respond_friend_request(
    p_account_id text,
    p_request_id uuid,
    p_action text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_request public.friend_requests%rowtype;
    v_low text;
    v_high text;
begin
    if p_action is null or p_action not in ('accept', 'decline') then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
    end if;
    select r.* into v_request from public.friend_requests r where r.id = p_request_id;
    if not found then
        raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    v_low := least(v_request.requester_id, v_request.recipient_id);
    v_high := greatest(v_request.requester_id, v_request.recipient_id);
    perform pg_advisory_xact_lock(hashtextextended(v_low || ':' || v_high, 0));

    select r.* into v_request
    from public.friend_requests r
    where r.id = p_request_id
    for update;
    if v_request.status <> 'pending' or v_request.recipient_id <> p_account_id then
        raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    if p_action = 'accept' then
        insert into public.friendships (user_low, user_high)
        values (v_low, v_high)
        on conflict do nothing;
        update public.friend_requests r
        set status = 'accepted', updated_at = now()
        where r.id = p_request_id;
    else
        update public.friend_requests r
        set status = 'declined', updated_at = now()
        where r.id = p_request_id;
    end if;
    return true;
end;
$$;

create or replace function public.profiles_cancel_friend_request(p_account_id text, p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_request public.friend_requests%rowtype;
    v_low text;
    v_high text;
begin
    select r.* into v_request from public.friend_requests r where r.id = p_request_id;
    if not found then
        raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    v_low := least(v_request.requester_id, v_request.recipient_id);
    v_high := greatest(v_request.requester_id, v_request.recipient_id);
    perform pg_advisory_xact_lock(hashtextextended(v_low || ':' || v_high, 0));
    select r.* into v_request
    from public.friend_requests r
    where r.id = p_request_id
    for update;
    if v_request.status <> 'pending' or v_request.requester_id <> p_account_id then
        raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    update public.friend_requests r
    set status = 'cancelled', updated_at = now()
    where r.id = p_request_id;
    return true;
end;
$$;

create or replace function public.profiles_remove_friend(p_account_id text, p_handle text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_friend_id text;
    v_low text;
    v_high text;
    v_count integer;
begin
    if p_handle is null or p_handle !~ '^[a-z0-9]{3,20}$' then
        raise exception using errcode = 'P0001', message = 'INVALID_HANDLE';
    end if;
    select p.id into v_friend_id
    from public.profiles p
    where p.handle = p_handle and p.id <> p_account_id;
    if not found then
        raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    v_low := least(p_account_id, v_friend_id);
    v_high := greatest(p_account_id, v_friend_id);
    perform pg_advisory_xact_lock(hashtextextended(v_low || ':' || v_high, 0));
    delete from public.friendships f
    where f.user_low = v_low and f.user_high = v_high;
    get diagnostics v_count = row_count;
    if v_count = 0 then
        raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    return true;
end;
$$;

create or replace function public.profiles_get_social_data(p_account_id text)
returns table (kind text, request_id uuid, display_name text, handle text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_profile_id text;
begin
    if p_account_id is null or p_account_id = '' then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
    end if;
    insert into public.profiles (id, display_name)
    values (p_account_id, 'Player')
    on conflict (id) do nothing;

    if not exists (select 1 from public.profiles p where p.id = p_account_id) then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
    end if;

    for v_profile_id in
        select f.user_high from public.friendships f where f.user_low = p_account_id
        union all
        select f.user_low from public.friendships f where f.user_high = p_account_id
        union all
        select r.requester_id from public.friend_requests r
        where r.recipient_id = p_account_id and r.status = 'pending'
        union all
        select r.recipient_id from public.friend_requests r
        where r.requester_id = p_account_id and r.status = 'pending'
    loop
        perform public.profiles_ensure_handle(v_profile_id);
    end loop;

    return query
    select 'friend'::text, null::uuid, p.display_name, p.handle
    from public.friendships f
    join public.profiles p on p.id = case when f.user_low = p_account_id then f.user_high else f.user_low end
    where f.user_low = p_account_id or f.user_high = p_account_id
    order by p.display_name
    limit 100;

    return query
    select 'incoming'::text, r.id, p.display_name, p.handle
    from public.friend_requests r
    join public.profiles p on p.id = r.requester_id
    where r.recipient_id = p_account_id and r.status = 'pending'
    order by r.created_at desc
    limit 100;

    return query
    select 'outgoing'::text, r.id, p.display_name, p.handle
    from public.friend_requests r
    join public.profiles p on p.id = r.recipient_id
    where r.requester_id = p_account_id and r.status = 'pending'
    order by r.created_at desc
    limit 100;
end;
$$;

revoke all on function public.profiles_ensure_handle(text) from public, anon, authenticated;
revoke all on function public.profiles_change_handle(text, text) from public, anon, authenticated;
revoke all on function public.profiles_search_public(text, text, text) from public, anon, authenticated;
revoke all on function public.profiles_get_public(text, text) from public, anon, authenticated;
revoke all on function public.profiles_send_friend_request(text, text) from public, anon, authenticated;
revoke all on function public.profiles_respond_friend_request(text, uuid, text) from public, anon, authenticated;
revoke all on function public.profiles_cancel_friend_request(text, uuid) from public, anon, authenticated;
revoke all on function public.profiles_remove_friend(text, text) from public, anon, authenticated;
revoke all on function public.profiles_get_social_data(text) from public, anon, authenticated;
grant execute on function public.profiles_ensure_handle(text) to service_role;
grant execute on function public.profiles_change_handle(text, text) to service_role;
grant execute on function public.profiles_search_public(text, text, text) to service_role;
grant execute on function public.profiles_get_public(text, text) to service_role;
grant execute on function public.profiles_send_friend_request(text, text) to service_role;
grant execute on function public.profiles_respond_friend_request(text, uuid, text) to service_role;
grant execute on function public.profiles_cancel_friend_request(text, uuid) to service_role;
grant execute on function public.profiles_remove_friend(text, text) to service_role;
grant execute on function public.profiles_get_social_data(text) to service_role;
