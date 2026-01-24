import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('game_plays', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('game_type', 50).notNullable(); // spin_wheel, dice_roll, lotto
    table.decimal('stake', 10, 2).notNullable();
    table.jsonb('bet_data'); // Bet details (prediction, numbers, etc)
    table.jsonb('result').notNullable(); // Outcome
    table.decimal('payout', 10, 2).defaultTo(0);
    table.string('rng_seed', 255).notNullable(); // For provably fair verification
    table.decimal('house_edge', 5, 4);
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // Indexes
    table.index('user_id');
    table.index('game_type');
    table.index('created_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('game_plays');
}