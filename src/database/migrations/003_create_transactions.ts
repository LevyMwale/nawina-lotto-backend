import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('transactions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('wallet_id').notNullable().references('id').inTable('wallets').onDelete('CASCADE');
    table.enum('type', ['deposit', 'withdrawal', 'bet', 'win', 'refund']).notNullable();
    table.decimal('amount', 15, 2).notNullable();
    table.enum('status', ['pending', 'completed', 'failed', 'cancelled']).defaultTo('pending');
    table.string('reference', 100).unique();
    table.jsonb('metadata');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // Indexes
    table.index('wallet_id');
    table.index('type');
    table.index('status');
    table.index('created_at');
    table.index('reference');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('transactions');
}