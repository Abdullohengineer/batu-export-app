-- Ombor may pack Moyka output and it may be dispatched WITHOUT a CHIQIM lab
-- pass (2026-11-19, user decision, docs/decisions/0246). Lab verdicts are
-- still recorded and shown (passport, Laborator screens, WIP "Tahlil
-- kechikdi"), but no longer gate anything: a qayta_yuvish verdict on an
-- already-packed serial is recorded only, its pallets stay dispatchable.
-- Supersedes the packing gate from 0035 (lab_relocation_core) and the
-- availability/FIFO lab gate from 0087-0089.
--
-- Long bodies are edited by exact-text replacement of the lab condition
-- only, each asserted, so the rest of every definition stays byte-identical
-- to what is live.
--
-- Deliberately NOT changed (flagged in 0246): rezka_kn_candidate_pallets
-- (Rezka Ichki draws still need a pass) and open_second_wash_cycle.

-- 1. Packing: finished_pallets INSERT no longer requires lab o_tdi.
alter policy ombor_writes on public.finished_pallets
  with check (my_role() = 'ombor');

-- 2. CHIQIM availability (Menejer's feasibility hint): drop the lab filter.
create or replace view public.finished_pallet_availability as
 SELECT fp.barcode2,
    fp.serial,
    fp.type_id,
    fp.calibre_id,
    fp.is_old_stock,
    fp.created_at,
    GREATEST((0)::numeric, ((fp.weight_kg - COALESCE(c.consumed_kg, (0)::numeric)) - COALESCE(d.drawn_kg, (0)::numeric))) AS available_kg,
    ko.owner_id
   FROM ((((finished_pallets fp
     LEFT JOIN ( SELECT chiqim_pallet_consumption.barcode2,
            sum(chiqim_pallet_consumption.qty_kg) AS consumed_kg
           FROM chiqim_pallet_consumption
          GROUP BY chiqim_pallet_consumption.barcode2) c ON ((c.barcode2 = fp.barcode2)))
     LEFT JOIN ( SELECT rezka_kn_draws.barcode2,
            sum(rezka_kn_draws.qty_kg) AS drawn_kg
           FROM rezka_kn_draws
          GROUP BY rezka_kn_draws.barcode2) d ON ((d.barcode2 = fp.barcode2)))
     LEFT JOIN kirim_lines kl ON ((kl.serial = fp.serial)))
     LEFT JOIN kirim_orders ko ON ((ko.order_id = kl.order_id)))
  WHERE (fp.status = 'in_stock'::pallet_status);

-- 3-5. Edit lab conditions out of the two functions and stock_on_hand_rows.
do $mig$
declare
  v_def text;
  v_new text;
begin
  -- 3. CHIQIM FIFO attribution at Ombor's finalize.
  select pg_get_functiondef('public.attribute_chiqim_line_fifo'::regproc) into v_def;
  v_new := regexp_replace(
    v_def,
    E'\\s+and\\s+\\(lr\\.verdict\\s*=\\s*''o_tdi''\\s+or\\s+exists\\s*\\(select 1 from public\\.rezka_cycles rc where rc\\.serial = fp\\.serial\\)\\)',
    '');
  if v_new = v_def then raise exception '0162: lab condition not found in attribute_chiqim_line_fifo'; end if;
  execute v_new;

  -- 4. Yakunlash (close a serial's open wash cycle, booking the residual).
  select pg_get_functiondef('public.close_wash_cycle_serial'::regproc) into v_def;
  v_new := regexp_replace(
    v_def,
    E'\\s+if v_lab_verdict is distinct from ''o_tdi'' then\\s+raise exception ''Seriya laborant tomonidan tasdiqlanmagan[^;]*;\\s+end if;',
    '');
  if v_new = v_def then raise exception '0162: lab check not found in close_wash_cycle_serial'; end if;
  execute v_new;

  -- 5. Qoldiq: no more awaiting_lab / qayta_yuvish buckets -- every
  -- in-stock pallet is 'available' (or band_qilingan), same as dispatch.
  select pg_get_viewdef('public.stock_on_hand_rows'::regclass) into v_def;
  v_new := regexp_replace(
    v_def,
    E'CASE\\s+WHEN \\(pallet_base\\.verdict = ''qayta_yuvish''::text\\) THEN ''qayta_yuvish''::text\\s+WHEN \\(\\(pallet_base\\.verdict IS NULL\\) AND \\(NOT pallet_base\\.is_rezka\\)\\) THEN ''awaiting_lab''::text\\s+ELSE NULL::text\\s+END AS forced_bucket',
    'NULL::text AS forced_bucket');
  if v_new = v_def then raise exception '0162: lab bucket CASE not found in stock_on_hand_rows'; end if;
  -- security_invoker=true is live on this view (client RLS depends on it);
  -- restated explicitly so the replace can't drop it.
  execute 'create or replace view public.stock_on_hand_rows with (security_invoker = true) as ' || v_new;
end
$mig$;
