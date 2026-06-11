import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('game_configs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('game_type', 50).notNullable().unique();
    table.jsonb('odds_config').notNullable();
    table.jsonb('payout_config').notNullable();
    table.decimal('min_stake', 10, 2);
    table.decimal('max_stake', 10, 2);
    table.boolean('is_active').defaultTo(true);
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('game_configs');
}