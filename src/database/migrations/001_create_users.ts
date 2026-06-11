import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('phone', 15).notNullable().unique();
    table.string('pin_hash', 255).notNullable();
    table.string('full_name', 100);
    table.string('national_id', 20);
    table.enum('kyc_status', ['pending', 'verified', 'rejected']).defaultTo('pending');
    table.date('date_of_birth');
    table.boolean('is_active').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Indexes
    table.index('phone');
    table.index('kyc_status');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}