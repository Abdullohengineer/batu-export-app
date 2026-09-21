-- Timeout step-down, step 1 of the agreed protocol (20s -> 12s -> 10s -> 8s,
-- backing off one level if any step increases timeouts).
--
-- 0134 raised this to 20s as a mitigation. 0213's measurement suggests that
-- may have been an own-goal: each pathological run now holds a connection up
-- to 20s instead of 8s, which is 2.5x more connection-seconds of contention
-- under a pile-up -- and contention is exactly what inflates these queries
-- 5-13x. Stepping down rather than cold-reverting so the theory is tested
-- empirically without risking a full regression.
--
-- Both roles for the same reason as 0134: PostgREST pools connect as
-- `authenticator`, and SET ROLE does not re-apply a role's stored GUC
-- defaults, so `authenticator` is the one that actually governs.
-- lock_timeout and anon deliberately unchanged.
alter role authenticator set statement_timeout = '12s';
alter role authenticated set statement_timeout = '12s';
