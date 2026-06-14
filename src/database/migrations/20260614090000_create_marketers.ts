import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('marketers', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('code', 20).notNullable().unique();
    table.string('phone', 20).notNullable().unique();
    table.string('pin_hash', 255).notNullable();
    table.string('full_name', 255).nullable();
    table.enum('status', ['active', 'suspended']).notNullable().defaultTo('active');
    table.decimal('commission_rate', 5, 4).notNullable().defaultTo(0);
    table.integer('total_signups').notNullable().defaultTo(0);
    table.decimal('total_deposits', 15, 2).notNullable().defaultTo(0);
    table.decimal('total_wagering', 15, 2).notNullable().defaultTo(0);
    table.uuid('created_by_admin').nullable().references('id').inTable('admins').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('code');
    table.index('status');
    table.index('phone');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('marketers');
}
