import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('game_configs', (table) => {
    table.jsonb('economy_config').nullable();
    table.jsonb('display_config').nullable();
    table.text('description').nullable();
    table.text('rules_text').nullable();
    table.integer('sort_order').nullable().defaultTo(0);
  });

  // Seed sensible economy defaults for existing rows.
  // 65% house margin / 35% RTP is the platform default.
  await knex('game_configs').update({
    economy_config: JSON.stringify({
      target_rtp: 0.35,
      target_house_margin: 0.65,
      distribution_strategy: 'frequent_small_wins',
      max_daily_payout: 50000,
      max_win_per_user_per_day: 10000,
    }),
    display_config: JSON.stringify({
      show_rtp: true,
      show_max_win: true,
    }),
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('game_configs', (table) => {
    table.dropColumn('economy_config');
    table.dropColumn('display_config');
    table.dropColumn('description');
    table.dropColumn('rules_text');
    table.dropColumn('sort_order');
  });
}
