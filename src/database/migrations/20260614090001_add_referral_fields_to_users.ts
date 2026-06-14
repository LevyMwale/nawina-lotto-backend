import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.uuid('referred_by_marketer_id').nullable().references('id').inTable('marketers').onDelete('SET NULL');
    table.timestamp('first_deposit_at').nullable();
    table.decimal('first_deposit_amount', 10, 2).nullable();
  });

  await knex.raw(`CREATE INDEX idx_users_referred_by_marketer ON users(referred_by_marketer_id)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('referred_by_marketer_id');
    table.dropColumn('first_deposit_at');
    table.dropColumn('first_deposit_amount');
  });
}
