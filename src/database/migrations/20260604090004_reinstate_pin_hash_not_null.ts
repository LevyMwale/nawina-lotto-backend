import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';

/**
 * Re-instate NOT NULL on users.pin_hash and re-hash any NULL rows to bcrypt("0000").
 *
 * Reverts migration 20260604090002_drop_pin_hash_not_null. The OTP path made the
 * column nullable, but we're going back to PIN auth and the model + app both
 * expect a non-null hash. We can't add NOT NULL while NULLs exist, so first we
 * set them to a known default ("0000") and log the affected phones — those users
 * will need to re-register or have their row deleted by an operator.
 */
export async function up(knex: Knex): Promise<void> {
  // 1. Find any orphaned users (null hash) and log them so the operator can
  //    contact them or delete the rows.
  const orphaned: Array<{ phone: string; id: string }> = await knex('users')
    .whereNull('pin_hash')
    .select('phone', 'id');
  if (orphaned.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[20260604090004] Found ${orphaned.length} user(s) with NULL pin_hash. ` +
        `Setting their pin to "0000" — they must re-register to set a real PIN. ` +
        `Affected phones: ${orphaned.map((u) => u.phone).join(', ')}`,
    );
  }

  // 2. Hash the default PIN once and apply to all orphaned rows in one UPDATE.
  if (orphaned.length > 0) {
    const defaultHash = await bcrypt.hash('0000', 12);
    await knex('users')
      .whereNull('pin_hash')
      .update({ pin_hash: defaultHash, updated_at: knex.fn.now() });
  }

  // 3. Now that no NULLs remain, re-add the NOT NULL constraint.
  await knex.raw('ALTER TABLE users ALTER COLUMN pin_hash SET NOT NULL');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE users ALTER COLUMN pin_hash DROP NOT NULL');
}
