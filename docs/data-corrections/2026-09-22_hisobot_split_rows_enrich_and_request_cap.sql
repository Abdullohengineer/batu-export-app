-- Hisobot: split report_query_page into a fast rows query + a set-based
-- enrichment pass, and cap runaway statements per request.
--
-- WHY (measured 2026-09-22, see docs/decisions/0218):
--   report_query_page is ONE statement that does three things: filter/order/
--   page the rows, then per-serial LATERAL kirim_line_report_bundle, then a
--   per-row LATERAL chiqim_dispatch_calibre_breakdown. Isolated it costs
--   ~315ms (rahbar) / ~1,035ms (client); under real traffic pg_stat_statements
--   shows mean 2,091ms and max 11,926ms against a 12s ceiling. Because the
--   browser aborting an HTTP request does NOT cancel the running statement,
--   rapid filter changes leave several ~2s statements holding connections out
--   of PostgREST's 10-connection pool; the 6th request queues and dies at the
--   12s statement_timeout.
--
-- NOT DONE HERE, deliberately:
--   - report_query_page itself is left LIVE and UNCHANGED (kept until the new
--     client path is verified; marked deprecated in 0218, not dropped).
--   - report_totals is left UNCHANGED. The original brief put a SET LOCAL
--     inside it; that is not implementable (see the cap section below), and
--     it needs no other change.
--   - The legacy p_direction TEXT overloads of report_query_page/report_totals
--     are NOT touched. Flagged in 0218; nothing in the app calls them.

-- ---------------------------------------------------------------------------
-- 1. report_query_page_rows -- the page of rows, and nothing else.
-- ---------------------------------------------------------------------------
-- Identical filters, identical ORDER BY, identical limit/offset to
-- report_query_page's own `f` CTE. Returns SETOF report_rows_v2, i.e. exactly
-- the 29 base columns, with none of the enrichment laterals.
create or replace function public.report_query_page_rows(
  p_directions  text[],
  p_from        date,
  p_to          date,
  p_owner_id    uuid,
  p_type_id     uuid,
  p_calibre_id  uuid,
  p_serial      text,
  p_barcode2    text,
  p_plate       text,
  p_driver      text,
  p_wash_cycle  text,
  p_lab_verdict text,
  p_status      text,
  p_limit       integer,
  p_offset      integer,
  p_partiya_no  integer
) returns setof report_rows_v2
language sql
stable
as $$
  select *
  from report_filtered_rows_v2(
    p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
    p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict,
    p_status, p_partiya_no
  )
  order by date_basis desc nulls last, row_key desc
  limit p_limit offset p_offset;
$$;

-- ---------------------------------------------------------------------------
-- 2. report_page_enrich -- both enrichment halves, set-based, in one call.
-- ---------------------------------------------------------------------------
-- Two grains in one result set, told apart by row_type:
--   'bundle'   -> key = serial      (20 bundle columns, dispatch_* NULL)
--   'dispatch' -> key = request_id  (bundle columns NULL, dispatch_* filled)
--
-- The 9 filter params are NOT optional and NOT a convenience: the dispatch
-- breakdown is filter-dependent. Same request_id returns (,10,,10,,10,,,)
-- with no filters and all-NULL under p_calibre_id='01' or
-- p_status='bekor_qilingan', because chiqim_component_is_match consumes every
-- one of them. Keying it on (request_id, from, to) alone would silently
-- produce different numbers from report_query_page.
--
-- COLUMN NAME REMAP -- load-bearing, do not "tidy". report_query_page's own
-- select list renames three bundle fields on the way out, and the client-side
-- join must reproduce it exactly:
--   output state_moykaga_yuborilgan           <- bundle.moyka_range_to_moyka_kg    (period)
--   output state_moykada                      <- bundle.moyka_asof                 (as of p_to)
--   output state_moykadan_chiqgan             <- bundle.moyka_range_from_moyka_kg  (period)
--   output state_moykaga_yuborilgan_lifetime  <- bundle.state_moykaga_yuborilgan   (lifetime)
--   output state_moykadan_chiqgan_lifetime    <- bundle.state_moykadan_chiqgan     (lifetime)
--   output state_k1..k8/state_kn              <- bundle.calibre_output_k1..k8/_kn
--   output state_yoqotish                     <- bundle.loss_range
--
-- NO LATERAL anywhere. The bundle half is one call to the already-shipped
-- kirim_line_report_bundle_set (0215). The dispatch half INLINES
-- chiqim_dispatch_calibre_breakdown's body as a single scan + GROUP BY
-- request_id, instead of calling it once per dispatch row. Keeping the two
-- halves in separate UNION ALL branches -- rather than in one top-level FROM
-- list -- is the specific structural change 0215's follow-up section
-- identified after its own report_query_page swap regressed to 8.9-16s with
-- both a 15-CTE set function and the dispatch LATERAL in the same query.
create or replace function public.report_page_enrich(
  p_serials       text[],
  p_dispatch_keys text[],
  p_from          date,
  p_to            date,
  p_directions    text[],
  p_type_id       uuid,
  p_calibre_id    uuid,
  p_serial        text,
  p_barcode2      text,
  p_wash_cycle    text,
  p_lab_verdict   text,
  p_status        text,
  p_partiya_no    integer
) returns table(
  row_type                          text,
  key                               text,
  state_qabul_qilingan              numeric,
  state_omborda_qoldi               numeric,
  state_moykaga_yuborilgan          numeric,
  state_moykada                     numeric,
  state_moykadan_chiqgan            numeric,
  state_xom_jonatilgan              numeric,
  state_olib_ketilgan               numeric,
  state_k1                          numeric,
  state_k2                          numeric,
  state_k3                          numeric,
  state_k4                          numeric,
  state_k5                          numeric,
  state_k6                          numeric,
  state_k7                          numeric,
  state_k8                          numeric,
  state_kn                          numeric,
  state_yoqotish                    numeric,
  state_moykaga_yuborilgan_lifetime numeric,
  state_moykadan_chiqgan_lifetime   numeric,
  dispatch_k1                       numeric,
  dispatch_k2                       numeric,
  dispatch_k3                       numeric,
  dispatch_k4                       numeric,
  dispatch_k5                       numeric,
  dispatch_k6                       numeric,
  dispatch_k7                       numeric,
  dispatch_k8                       numeric,
  dispatch_kn                       numeric
)
language sql
stable
as $$
  -- bundle half: one set-based call, one row per requested serial
  select
    'bundle'::text, b.serial,
    b.state_qabul_qilingan,
    b.state_omborda_qoldi,
    b.moyka_range_to_moyka_kg,      -- -> state_moykaga_yuborilgan  (period)
    b.moyka_asof,                   -- -> state_moykada
    b.moyka_range_from_moyka_kg,    -- -> state_moykadan_chiqgan    (period)
    b.state_xom_jonatilgan,
    b.state_olib_ketilgan,
    b.calibre_output_k1, b.calibre_output_k2, b.calibre_output_k3,
    b.calibre_output_k4, b.calibre_output_k5, b.calibre_output_k6,
    b.calibre_output_k7, b.calibre_output_k8, b.calibre_output_kn,
    b.loss_range,                   -- -> state_yoqotish
    b.state_moykaga_yuborilgan,     -- -> ..._lifetime
    b.state_moykadan_chiqgan,       -- -> ..._lifetime
    null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
    null::numeric, null::numeric, null::numeric, null::numeric
  from kirim_line_report_bundle_set(p_serials, p_from, p_to) b
  where p_serials is not null and array_length(p_serials, 1) is not null

  union all

  -- dispatch half: chiqim_dispatch_calibre_breakdown's body, inlined and
  -- grouped, so N request_ids cost ONE scan instead of N function calls.
  -- A request_id with no matching component rows produces no group here; the
  -- old LEFT JOIN LATERAL produced a row of NULLs. Both render as "no
  -- enrichment" once joined client-side, so the visible result is the same.
  select
    'dispatch'::text, m.request_id::text,
    null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
    null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
    null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
    null::numeric, null::numeric, null::numeric, null::numeric,
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '01'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '02'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '03'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '04'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '05'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '06'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '07'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '08'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = 'KN'), 0), 0)
  from (
    select
      r.request_id,
      r.qty_kg,
      cal.code as calibre_code,
      chiqim_component_is_match(
        'chiqim'::text, r.calibre_id, r.barcode2, r.wash_cycle, r.lab_verdict,
        r.pallet_status, r.serial, r.type_id, r.partiya_no,
        p_directions, p_calibre_id, p_barcode2, p_wash_cycle, p_lab_verdict,
        p_status, p_serial, p_type_id, p_partiya_no
      ) as is_match
    from report_chiqim_rows_v2 r
    left join calibres cal on cal.id = r.calibre_id
    where r.request_id = any (
            select k::uuid from unnest(coalesce(p_dispatch_keys, '{}'::text[])) k
          )
      and r.date_basis between p_from and p_to
  ) m
  group by m.request_id;
$$;

-- ---------------------------------------------------------------------------
-- 3. Per-request 5s cap -- via db-pre-request, NOT inside the functions.
-- ---------------------------------------------------------------------------
-- The brief asked for `SET LOCAL statement_timeout = '5s'` inside the report
-- functions. That is not implementable, measured 2026-09-22:
--
--   variant                                                  elapsed  outcome
--   LANGUAGE sql + function-level SET statement_timeout='1s'   3.01s  COMPLETED, no timeout
--   LANGUAGE plpgsql STABLE + SET LOCAL statement_timeout      0.00s  ERROR 0A000: SET is not
--                                                                     allowed in a non-volatile function
--   SET LOCAL in a PRECEDING statement of the same transaction  ~1s   CANCELLED 57014  <-- works
--
-- The function-level SET *is* applied (a sql function carrying it reads
-- statement_timeout='1s' inside its own body while the session reads '2min')
-- -- but statement_timeout is armed once when the statement starts and is
-- never re-armed when the GUC changes mid-statement, so it caps nothing.
-- Making the function VOLATILE to satisfy plpgsql would also defeat SQL
-- inlining, the change 0215 measured at 2,845ms -> 12,007ms.
--
-- PostgREST runs each request in its own transaction and calls db-pre-request
-- as a SEPARATE statement first, which is exactly the shape proven to work
-- above. Scoped by request.path so only these four RPCs are capped; every
-- other request keeps the 12s role default.
--
-- FAIL-SAFE: if request.path is unset or unrecognised the function does
-- nothing, so a wrong assumption about PostgREST's GUC degrades to today's
-- behaviour rather than capping every request in the app.
create or replace function public.pgrst_statement_cap()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  p text := current_setting('request.path', true);
begin
  if p in (
    '/rpc/report_query_page_rows',
    '/rpc/report_page_enrich',
    '/rpc/report_totals',
    '/rpc/report_query_page'
  ) then
    set local statement_timeout = '5s';
  end if;
end;
$$;

revoke all on function public.pgrst_statement_cap() from public;
grant execute on function public.pgrst_statement_cap() to authenticator, authenticated, anon;

-- APPLIED SEPARATELY, after the functions above are verified (see 0218):
--   alter role authenticator set pgrst.db_pre_request = 'public.pgrst_statement_cap';
--   notify pgrst, 'reload config';
--
-- ROLLBACK (cap only -- instant, no redeploy):
--   alter role authenticator reset pgrst.db_pre_request;
--   notify pgrst, 'reload config';
--
-- ROLLBACK (functions): both are NEW names with no dependants, so
--   drop function if exists public.report_query_page_rows(text[],date,date,uuid,uuid,uuid,text,text,text,text,text,text,text,integer,integer,integer);
--   drop function if exists public.report_page_enrich(text[],text[],date,date,text[],uuid,uuid,text,text,text,text,text,integer);
--   drop function if exists public.pgrst_statement_cap();
-- report_query_page and report_totals are untouched by this file, so the
-- frontend reverts to the old path by reverting the app deploy alone.
