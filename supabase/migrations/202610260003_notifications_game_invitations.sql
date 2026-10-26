create table if not exists public.game_invitations (
    id uuid primary key default gen_random_uuid(),
    sender_id text not null references public.profiles(id) on delete cascade,
    recipient_id text not null references public.profiles(id) on delete cascade,
    room_code text not null check (room_code ~ '^[A-Z]{4}$'),
    room_instance_id uuid not null,
    status text not null default 'pending'
        check (status in ('pending', 'accepted', 'declined', 'expired')),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '24 hours'),
    updated_at timestamptz not null default now(),
    check (sender_id <> recipient_id),
    check (expires_at > created_at)
);

create unique index if not exists game_invitations_one_pending_pair_idx
    on public.game_invitations (sender_id, recipient_id, room_code)
    where status = 'pending';
create index if not exists game_invitations_recipient_pending_idx
    on public.game_invitations (recipient_id, created_at desc)
    where status = 'pending';

create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),
    recipient_id text not null references public.profiles(id) on delete cascade,
    actor_id text not null references public.profiles(id) on delete cascade,
    notification_type text not null
        check (notification_type in ('friend_request', 'accepted_friend_request', 'game_invitation')),
    friend_request_id uuid references public.friend_requests(id) on delete cascade,
    game_invitation_id uuid references public.game_invitations(id) on delete cascade,
    created_at timestamptz not null default now(),
    read_at timestamptz,
    check (recipient_id <> actor_id),
    check (
        (notification_type in ('friend_request', 'accepted_friend_request')
            and friend_request_id is not null and game_invitation_id is null)
        or
        (notification_type = 'game_invitation'
            and game_invitation_id is not null and friend_request_id is null)
    )
);

create unique index if not exists notifications_friend_event_dedupe_idx
    on public.notifications (recipient_id, notification_type, friend_request_id)
    where friend_request_id is not null;
create unique index if not exists notifications_game_invitation_dedupe_idx
    on public.notifications (recipient_id, game_invitation_id)
    where game_invitation_id is not null;
create index if not exists notifications_recipient_created_idx
    on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_unread_idx
    on public.notifications (recipient_id, created_at desc)
    where read_at is null;

alter table public.game_invitations enable row level security;
alter table public.notifications enable row level security;
revoke all on table public.game_invitations, public.notifications from anon, authenticated;
grant all on table public.game_invitations, public.notifications to service_role;

create or replace function public.notifications_from_friend_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if tg_op = 'INSERT' and new.status = 'pending' then
        insert into public.notifications (
            recipient_id, actor_id, notification_type, friend_request_id
        ) values (
            new.recipient_id, new.requester_id, 'friend_request', new.id
        ) on conflict do nothing;
    elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
        insert into public.notifications (
            recipient_id, actor_id, notification_type, friend_request_id
        ) values (
            new.requester_id, new.recipient_id, 'accepted_friend_request', new.id
        ) on conflict do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists friend_requests_create_notifications on public.friend_requests;
create trigger friend_requests_create_notifications
    after insert or update of status on public.friend_requests
    for each row
    execute function public.notifications_from_friend_request();

create or replace function public.notifications_list(
    p_account_id text,
    p_limit integer default 20,
    p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_items jsonb;
    v_unread integer;
    v_total integer;
    v_actor_id text;
begin
    if p_account_id is null or p_account_id = ''
       or p_limit is null or p_limit < 1 or p_limit > 50
       or p_offset is null or p_offset < 0 or p_offset > 500 then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
    end if;

    for v_actor_id in
        select distinct page.actor_id
        from (
            select n.actor_id
            from public.notifications n
            where n.recipient_id = p_account_id
            order by n.created_at desc, n.id desc
            limit p_limit offset p_offset
        ) page
        order by page.actor_id
    loop
        perform public.profiles_ensure_handle(v_actor_id);
    end loop;

    select count(*)::integer into v_unread
    from public.notifications n
    where n.recipient_id = p_account_id and n.read_at is null;
    select count(*)::integer into v_total
    from public.notifications n
    where n.recipient_id = p_account_id;

    select coalesce(jsonb_agg(item order by created_at desc, id desc), '[]'::jsonb)
    into v_items
    from (
        select
            n.created_at,
            n.id,
            jsonb_build_object(
                'id', n.id,
                'type', n.notification_type,
                'createdAt', n.created_at,
                'readAt', n.read_at,
                'actor', jsonb_build_object('displayName', actor.display_name, 'handle', actor.handle),
                'requestId', n.friend_request_id,
                'invitation', case when gi.id is null then null else jsonb_build_object(
                    'id', gi.id,
                    'roomCode', gi.room_code,
                    'expiresAt', gi.expires_at,
                    'status', case
                        when gi.status = 'pending' and gi.expires_at <= now() then 'expired'
                        else gi.status
                    end
                ) end
            ) as item
        from public.notifications n
        join public.profiles actor on actor.id = n.actor_id
        left join public.game_invitations gi on gi.id = n.game_invitation_id
        where n.recipient_id = p_account_id
        order by n.created_at desc, n.id desc
        limit p_limit offset p_offset
    ) page;

    return jsonb_build_object(
        'notifications', v_items,
        'unreadCount', v_unread,
        'hasMore', p_offset + p_limit < v_total
    );
end;
$$;

create or replace function public.notifications_mark_read(
    p_account_id text,
    p_notification_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_updated integer;
begin
    if p_account_id is null or p_account_id = '' or p_notification_id is null then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
    end if;
    update public.notifications
    set read_at = coalesce(read_at, now())
    where id = p_notification_id and recipient_id = p_account_id;
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    return true;
end;
$$;

create or replace function public.profiles_send_game_invitation(
    p_account_id text,
    p_recipient_handle text,
    p_room_code text,
    p_room_instance_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_recipient_id text;
    v_invitation_id uuid;
begin
    if p_account_id is null or p_account_id = ''
       or p_room_code is null or p_room_code !~ '^[A-Z]{4}$'
       or p_room_instance_id is null
       or p_recipient_handle is null or p_recipient_handle !~ '^[a-z0-9]{3,20}$' then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
    end if;
    select p.id into v_recipient_id
    from public.profiles p
    where p.handle = p_recipient_handle and p.id <> p_account_id;
    if not found then
        raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    if not exists (
        select 1 from public.friendships f
        where f.user_low = least(p_account_id, v_recipient_id)
          and f.user_high = greatest(p_account_id, v_recipient_id)
    ) then
        raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    update public.game_invitations
    set status = 'expired', updated_at = now()
    where sender_id = p_account_id and recipient_id = v_recipient_id
      and room_code = p_room_code and status = 'pending' and expires_at <= now();
    insert into public.game_invitations (sender_id, recipient_id, room_code, room_instance_id)
    values (p_account_id, v_recipient_id, p_room_code, p_room_instance_id)
    returning id into v_invitation_id;
    insert into public.notifications (
        recipient_id, actor_id, notification_type, game_invitation_id
    ) values (
        v_recipient_id, p_account_id, 'game_invitation', v_invitation_id
    ) on conflict do nothing;
    return v_invitation_id;
exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
end;
$$;

create or replace function public.profiles_get_game_invitation(
    p_account_id text,
    p_invitation_id uuid
)
returns table (
    invitation_id uuid,
    room_code text,
    room_instance_id uuid,
    expires_at timestamptz,
    status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if p_account_id is null or p_account_id = '' or p_invitation_id is null then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
    end if;
    update public.game_invitations
    set status = 'expired', updated_at = now()
    where id = p_invitation_id and recipient_id = p_account_id
      and status = 'pending' and expires_at <= now();
    return query
    select g.id, g.room_code, g.room_instance_id, g.expires_at, g.status
    from public.game_invitations g
    where g.id = p_invitation_id and g.recipient_id = p_account_id;
end;
$$;

create or replace function public.profiles_set_game_invitation_status(
    p_account_id text,
    p_invitation_id uuid,
    p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_updated integer;
begin
    if p_account_id is null or p_account_id = '' or p_invitation_id is null
       or p_status not in ('accepted', 'declined') then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
    end if;
    update public.game_invitations
    set status = p_status, updated_at = now()
    where id = p_invitation_id and recipient_id = p_account_id
      and status = 'pending' and expires_at > now();
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    return true;
end;
$$;

revoke all on function public.notifications_from_friend_request() from public, anon, authenticated;
revoke all on function public.notifications_list(text, integer, integer) from public, anon, authenticated;
revoke all on function public.notifications_mark_read(text, uuid) from public, anon, authenticated;
revoke all on function public.profiles_send_game_invitation(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.profiles_get_game_invitation(text, uuid) from public, anon, authenticated;
revoke all on function public.profiles_set_game_invitation_status(text, uuid, text) from public, anon, authenticated;
grant execute on function public.notifications_list(text, integer, integer) to service_role;
grant execute on function public.notifications_mark_read(text, uuid) to service_role;
grant execute on function public.profiles_send_game_invitation(text, text, text, uuid) to service_role;
grant execute on function public.profiles_get_game_invitation(text, uuid) to service_role;
grant execute on function public.profiles_set_game_invitation_status(text, uuid, text) to service_role;
