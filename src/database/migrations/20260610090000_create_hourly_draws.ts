import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create hourly_draws table
  await knex.schema.createTable('hourly_draws', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.timestamp('scheduled_at').notNullable();
    table.enum('status', ['open', 'closed', 'completed', 'cancelled']).notNullable().defaultTo('open');
    table.decimal('ticket_price', 10, 2).notNullable().defaultTo(10);
    table.decimal('total_pool', 10, 2).notNullable().defaultTo(0);
    table.decimal('prize_pool', 10, 2).notNullable().defaultTo(0);
    table.decimal('house_edge_amount', 10, 2).notNullable().defaultTo(0);
    table.decimal('admin_prize_pool', 10, 2).nullable(); // Admin-set prize amount for next draw
    table.uuid('winner_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    table.integer('winning_ticket_number').nullable();
    table.string('rng_seed', 255).nullable(); // For provably fair verification
    table.timestamp('completed_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // Indexes
    table.index('scheduled_at');
    table.index('status');
    table.index('winner_user_id');
  });

  // Create hourly_draw_entries table
  await knex.schema.createTable('hourly_draw_entries', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('draw_id').notNullable().references('id').inTable('hourly_draws').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.integer('ticket_number').notNullable();
    table.decimal('amount_paid', 10, 2).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // Unique constraint: each ticket number is unique within a draw
    table.unique(['draw_id', 'ticket_number']);

    // Indexes
    table.index('draw_id');
    table.index('user_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('hourly_draw_entries');
  await knex.schema.dropTableIfExists('hourly_draws');
}
