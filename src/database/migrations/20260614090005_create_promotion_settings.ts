import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('promotion_settings', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('key', 50).notNullable().unique();
    table.jsonb('value').notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex('promotion_settings').insert({
    key: 'onboarding_bonus',
    value: JSON.stringify({
      percent: 0.30,
      cap: 100,
      wagering_multiplier: 5,
      expiry_days: 7,
      enabled: true,
    }),
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('promotion_settings');
}
