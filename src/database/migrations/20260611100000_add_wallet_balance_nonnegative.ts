import type { Knex } from 'knex';

/**
 * Prevent negative wallet balances at the DB level.
 * This guards against race conditions and double-deduction bugs.
 * Zero balance is allowed (new users / broke players).
 */
export async function up(knex: Knex): Promise<void> {
  // Fix any existing negative balances first (set to 0 and log them)
  const negatives = await knex('wallets').where('balance', '<', 0).select('id', 'user_id', 'balance');
  if (negatives.length > 0) {
    console.warn(`[Migration] Found ${negatives.length} wallets with negative balance:`, negatives);
    await knex('wallets').where('balance', '<', 0).update({ balance: 0 });
  }

  await knex.raw('ALTER TABLE wallets ADD CONSTRAINT wallets_balance_nonnegative CHECK (balance >= 0)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_balance_nonnegative');
}
