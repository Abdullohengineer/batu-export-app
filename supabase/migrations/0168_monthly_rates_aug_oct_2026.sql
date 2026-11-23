-- Owner request 2026-11-23 (docs/decisions/0252): Aug, Sep and Oct 2026 use
-- the same rates as Nov 2026 -- moyka 7,468.75 and rezka 4,133.93 so'm/kg.
-- monthly_rates has no app write path (set via admin, decision 0249).
insert into public.monthly_rates (period_month, service_type, rate_per_kg, set_by)
select m::date, s.service_type, s.rate, 'Abdulloh (via admin, 2026-11-23)'
from unnest(array['2026-08-01', '2026-09-01', '2026-10-01']) as m,
     (values ('moyka', 7468.75::numeric), ('rezka', 4133.93::numeric)) as s(service_type, rate)
on conflict (period_month, service_type) do nothing;
