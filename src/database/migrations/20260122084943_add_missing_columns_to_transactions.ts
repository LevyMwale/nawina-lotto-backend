import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Check if columns exist before adding them
  const hasBalanceBefore = await knex.schema.hasColumn('transactions', 'balance_before');
  const hasBalanceAfter = await knex.schema.hasColumn('transactions', 'balance_after');
  const hasStatus = await knex.schema.hasColumn('transactions', 'status');

  await knex.schema.alterTable('transactions', (table) => {
    if (!hasBalanceBefore) {
      table.decimal('balance_before', 10, 2).notNullable().defaultTo(0);
    }
    if (!hasBalanceAfter) {
      table.decimal('balance_after', 10, 2).notNullable().defaultTo(0);
    }
    if (!hasStatus) {
      table.enum('status', ['pending', 'completed', 'failed', 'cancelled'])
        .notNullable()
        .defaultTo('pending');
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('transactions', (table) => {
    table.dropColumn('balance_before');
    table.dropColumn('balance_after');
    table.dropColumn('status');
  });
}