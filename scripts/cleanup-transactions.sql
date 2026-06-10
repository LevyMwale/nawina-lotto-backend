-- ============================================================================
-- CLEANUP SCRIPT: Delete all transactions before 2026-06-10 13:00
-- Run each block separately in Supabase SQL Editor
-- ============================================================================

-- STEP 1: Count what will be deleted
SELECT
  COUNT(*) as total_to_delete,
  SUM(CASE WHEN type = 'deposit' THEN 1 ELSE 0 END) as deposits,
  SUM(CASE WHEN type = 'withdrawal' THEN 1 ELSE 0 END) as withdrawals,
  SUM(CASE WHEN type = 'bet' THEN 1 ELSE 0 END) as bets,
  SUM(CASE WHEN type = 'win' THEN 1 ELSE 0 END) as wins
FROM transactions
WHERE created_at < '2026-06-10 13:00:00';

-- STEP 2: Delete them
DELETE FROM transactions
WHERE created_at < '2026-06-10 13:00:00';

-- STEP 3: Recalculate all wallet balances from remaining completed transactions
-- (optional — only run if you want balances to match the cleaned data)
UPDATE wallets
SET balance = (
  SELECT COALESCE(
    SUM(
      CASE
        WHEN type IN ('deposit', 'win', 'bonus', 'refund') THEN amount
        WHEN type IN ('withdrawal', 'bet') THEN -amount
        ELSE 0
      END
    ), 0
  )
  FROM transactions
  WHERE transactions.wallet_id = wallets.id
    AND transactions.status = 'completed'
);

-- STEP 4: Verify results
SELECT
  w.id,
  u.phone,
  w.balance,
  (SELECT COUNT(*) FROM transactions t WHERE t.wallet_id = w.id) as txn_count
FROM wallets w
JOIN users u ON u.id = w.user_id
ORDER BY w.balance DESC;
