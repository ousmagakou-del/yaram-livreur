-- ════════════════════════════════════════════════════════════════════
-- YARAM — Admin Support RPCs
-- ════════════════════════════════════════════════════════════════════
-- Les tables support_tickets / support_messages ont une RLS owner-only :
-- chaque cliente ne voit QUE ses tickets. L'admin n'a pas de policy
-- "select all" (volontaire — on évite de fuiter via PostgREST). On expose
-- donc des RPC SECURITY DEFINER protégées par is_admin().
--
-- À appliquer via Supabase SQL editor ou `supabase db push`.
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1) admin_list_tickets — liste tous les tickets avec contexte joint
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_tickets(p_status text DEFAULT 'all')
RETURNS TABLE (
  id              uuid,
  user_id         uuid,
  user_name       text,
  user_email      text,
  user_phone      text,
  subject         text,
  category        text,
  status          text,
  priority        text,
  order_id        text,
  product_id      uuid,
  created_at      timestamptz,
  updated_at      timestamptz,
  resolved_at     timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  message_count   bigint,
  unread_admin    boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.user_id,
    COALESCE(
      NULLIF(TRIM(CONCAT_WS(' ', up.first_name, up.last_name)), ''),
      up.first_name,
      'Cliente'
    ) AS user_name,
    COALESCE(up.email, au.email)            AS user_email,
    up.phone                                 AS user_phone,
    t.subject,
    t.category,
    t.status,
    COALESCE(t.priority, 'normal')           AS priority,
    t.order_id,
    t.product_id,
    t.created_at,
    t.updated_at,
    t.resolved_at,
    lm.created_at                            AS last_message_at,
    LEFT(COALESCE(lm.content, ''), 140)      AS last_message_preview,
    COALESCE(mc.cnt, 0)                      AS message_count,
    (t.status = 'awaiting_response')         AS unread_admin
  FROM   public.support_tickets t
  LEFT   JOIN public.users_profile up ON up.id = t.user_id
  LEFT   JOIN auth.users          au ON au.id = t.user_id
  LEFT   JOIN LATERAL (
           SELECT content, created_at
           FROM   public.support_messages m
           WHERE  m.ticket_id = t.id
           ORDER  BY m.created_at DESC
           LIMIT  1
         ) lm ON true
  LEFT   JOIN LATERAL (
           SELECT COUNT(*) AS cnt
           FROM   public.support_messages m
           WHERE  m.ticket_id = t.id
         ) mc ON true
  WHERE  (p_status = 'all' OR t.status = p_status)
  ORDER  BY
    CASE WHEN t.status = 'awaiting_response' THEN 0 ELSE 1 END,
    COALESCE(lm.created_at, t.created_at) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_tickets(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_tickets(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2) admin_list_ticket_messages — tous les messages d'un ticket
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_ticket_messages(p_ticket_id uuid)
RETURNS TABLE (
  id           uuid,
  ticket_id    uuid,
  sender_type  text,
  sender_name  text,
  sender_id    uuid,
  content      text,
  attachments  jsonb,
  created_at   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.ticket_id,
    m.sender_type,
    m.sender_name,
    m.sender_id,
    m.content,
    COALESCE(m.attachments, '[]'::jsonb) AS attachments,
    m.created_at
  FROM   public.support_messages m
  WHERE  m.ticket_id = p_ticket_id
  ORDER  BY m.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_ticket_messages(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_ticket_messages(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3) admin_send_ticket_message — admin répond à un ticket
-- ─────────────────────────────────────────────────────────────────────
-- Insère un message côté admin et met automatiquement le ticket en
-- status='awaiting_user' pour signaler à la cliente qu'elle a une réponse.
CREATE OR REPLACE FUNCTION public.admin_send_ticket_message(
  p_ticket_id  uuid,
  p_content    text,
  p_admin_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id   uuid := auth.uid();
  v_admin_name text;
  v_msg_id     uuid;
  v_ticket     public.support_tickets%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_content IS NULL OR LENGTH(TRIM(p_content)) = 0 THEN
    RAISE EXCEPTION 'empty_content' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = '02000';
  END IF;

  -- Résout le nom de l'admin : param > admin_users.name > email
  IF p_admin_name IS NOT NULL AND LENGTH(TRIM(p_admin_name)) > 0 THEN
    v_admin_name := TRIM(p_admin_name);
  ELSE
    SELECT COALESCE(
             NULLIF(au_meta.name, ''),
             SPLIT_PART(au.email, '@', 1),
             'Support YARAM'
           )
      INTO v_admin_name
      FROM auth.users au
      LEFT JOIN public.admin_users au_meta ON au_meta.email = au.email
     WHERE au.id = v_admin_id;

    v_admin_name := COALESCE(v_admin_name, 'Support YARAM');
  END IF;

  INSERT INTO public.support_messages (
    ticket_id, sender_type, sender_name, sender_id, content, created_at
  ) VALUES (
    p_ticket_id, 'admin', v_admin_name, v_admin_id, TRIM(p_content), now()
  )
  RETURNING id INTO v_msg_id;

  UPDATE public.support_tickets
     SET status     = 'awaiting_user',
         updated_at = now()
   WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success',      true,
    'message_id',   v_msg_id,
    'sender_name',  v_admin_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_send_ticket_message(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_send_ticket_message(uuid, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4) admin_update_ticket_status — change le statut d'un ticket
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_update_ticket_status(
  p_ticket_id uuid,
  p_status    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed text[] := ARRAY['open','awaiting_response','awaiting_user','resolved','closed'];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT (p_status = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'invalid_status: %', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.support_tickets
     SET status      = p_status,
         updated_at  = now(),
         resolved_at = CASE WHEN p_status = 'resolved' THEN now() ELSE resolved_at END
   WHERE id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = '02000';
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_ticket_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_ticket_status(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 5) admin_ticket_stats — compteurs pour le header admin
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_ticket_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'open',              COUNT(*) FILTER (WHERE status = 'open'),
    'awaiting_response', COUNT(*) FILTER (WHERE status = 'awaiting_response'),
    'awaiting_user',     COUNT(*) FILTER (WHERE status = 'awaiting_user'),
    'resolved',          COUNT(*) FILTER (WHERE status = 'resolved'),
    'today_new',         COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()))
  )
  INTO v_result
  FROM public.support_tickets;

  RETURN COALESCE(v_result, jsonb_build_object(
    'open', 0, 'awaiting_response', 0, 'awaiting_user', 0, 'resolved', 0, 'today_new', 0
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ticket_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_ticket_stats() TO authenticated;
