import { Knex } from 'knex';

/**
 * Drop the NOT NULL constraint on users.pin_hash.
 *
 * OTP is the only login path now. New users are inserted without a pin_hash
 * (it would always be null), so the column needs to accept NULL.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE users ALTER COLUMN pin_hash DROP NOT NULL');
}

export async function down(knex: Knex): Promise<void> {
  // Going back requires deleting null rows first, otherwise the constraint
  // cannot be re-applied. The down() is only useful in a rollback scenario.
  await knex.raw('DELETE FROM users WHERE pin_hash IS NULL');
  await knex.raw('ALTER TABLE users ALTER COLUMN pin_hash SET NOT NULL');
}
