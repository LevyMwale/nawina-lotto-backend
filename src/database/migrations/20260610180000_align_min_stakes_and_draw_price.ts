import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Align all active game minimum stakes to K2 and fix lotto fixed stakes.
  await knex('game_configs')
    .where({ is_active: true })
    .whereIn('game_type', [
      'spin_wheel',
      'dice_roll',
      'blackjack',
      'soccer_quiz',
    ])
    .update({ min_stake: 2 });

  // Lotto games: min stake K2, max stake K10,000.
  await knex('game_configs')
    .where({ is_active: true })
    .whereIn('game_type', ['lotto_pick3', 'lotto_pick5'])
    .update({ min_stake: 2, max_stake: 10000 });

  // Fix any open draws that still carry the old K10 ticket price.
  await knex('hourly_draws')
    .where({ status: 'open' })
    .where('ticket_price', '!=', 2)
    .update({ ticket_price: 2 });
}

export async function down(knex: Knex): Promise<void> {
  // No reversible down migration for config changes — they are
  // idempotent updates to live data.
}
