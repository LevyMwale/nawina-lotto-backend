import { Knex } from 'knex';

/**
 * New users can be created via OTP and have a wallet with balance = 0
 * (they deposit later). The original CHECK (balance > 0) prevented this
 * — it was a reasonable default for manually seeded data, but the OTP
 * signup flow needs zero-balance wallets to be valid.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_balance_check');
}

export async function down(knex: Knex): Promise<void> {
  // Re-applying requires that no zero-balance wallets exist.
  await knex.raw('UPDATE wallets SET balance = 0.01 WHERE balance = 0');
  await knex.raw('ALTER TABLE wallets ADD CONSTRAINT wallets_balance_check CHECK (balance > 0)');
}
