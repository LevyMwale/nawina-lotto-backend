-- ============================================================================
-- CLEANUP: Fix stale draws + update ticket price
-- Run this in Supabase SQL Editor
-- ============================================================================

-- 1. Delete stale open draws (any open draw whose scheduled time has already passed
--    and is NOT at 08:00 or 18:00, OR any open draw that is in the past)
DELETE FROM hourly_draws
WHERE status = 'open'
  AND (
    scheduled_at < NOW()
    OR EXTRACT(HOUR FROM scheduled_at) NOT IN (8, 18)
  );

-- 2. Update remaining open draws to K2 ticket price
UPDATE hourly_draws SET ticket_price = 2 WHERE status = 'open';

-- 3. Verify what's left
SELECT id, scheduled_at, status, ticket_price, total_entries, prize_pool
FROM hourly_draws
WHERE status = 'open'
ORDER BY scheduled_at;
