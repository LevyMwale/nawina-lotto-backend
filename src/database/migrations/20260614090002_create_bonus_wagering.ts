import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('bonus_wagering', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.uuid('bonus_transaction_id').notNullable().references('id').inTable('transactions').onDelete('CASCADE');
    table.uuid('marketer_id').nullable().references('id').inTable('marketers').onDelete('SET NULL');
    table.decimal('amount', 10, 2).notNullable();
    table.decimal('wagering_required', 10, 2).notNullable().defaultTo(0);
    table.decimal('wagering_completed', 10, 2).notNullable().defaultTo(0);
    table.enum('status', ['active', 'released', 'expired', 'forfeited']).notNullable().defaultTo('active');
    table.timestamp('expires_at').nullable();
    table.timestamp('released_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('user_id');
    table.index('status');
    table.index('marketer_id');
    table.unique(['bonus_transaction_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('bonus_wagering');
}
