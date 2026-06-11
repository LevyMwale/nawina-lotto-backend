import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('otp_codes', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('phone', 15).notNullable();
    table.string('code_hash', 255).notNullable();
    table.specificType('attempts', 'smallint').notNullable().defaultTo(0);
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('consumed_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.specificType('ip', 'inet');
  });

  // "Most recent active code for this phone" lookup is the hot path during verify.
  await knex.schema.alterTable('otp_codes', (table) => {
    table.index(['phone', 'created_at'], 'idx_otp_codes_phone_created');
  });
  // Partial index on unconsumed rows via raw SQL — Knex's TableBuilder doesn't
  // expose a clean whereNull() at index-creation time across all dialects.
  await knex.raw(
    'CREATE INDEX idx_otp_codes_phone_active ON otp_codes (phone, expires_at) WHERE consumed_at IS NULL',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_otp_codes_phone_active');
  await knex.schema.dropTableIfExists('otp_codes');
}
