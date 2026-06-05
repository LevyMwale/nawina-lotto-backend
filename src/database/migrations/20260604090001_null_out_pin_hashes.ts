import { Knex } from 'knex';

/**
 * One-shot data migration: null out stored PINs so they can no longer be
 * used to authenticate. OTP is the only login path going forward.
 *
 * The `pin_hash` column is intentionally retained for now in case any
 * audit/seed tooling references it; a separate, later migration can drop it.
 *
 * `down()` is intentionally a no-op: we cannot recover the original hashes.
 */
export async function up(knex: Knex): Promise<void> {
  await knex('users').update({ pin_hash: null }).whereNotNull('pin_hash');
}

export async function down(_knex: Knex): Promise<void> {
  // No-op: the original PIN hashes cannot be recovered.
}
