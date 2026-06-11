import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Fix all game configs that have restrictive max_stake values.
  // User-facing max should be K10,000 for every game.
  await knex('game_configs')
    .whereIn('game_type', [
      'spin_wheel',
      'dice_roll',
      'lotto_pick3',
      'lotto_pick5',
      'blackjack',
      'soccer_quiz',
    ])
    .update({ max_stake: 10000 });

  // Also bump aviator if it ever got inserted into game_configs
  await knex('game_configs')
    .where({ game_type: 'aviator' })
    .update({ max_stake: 10000 });
}

export async function down(knex: Knex): Promise<void> {
  // No reversible down — these are forward-only config corrections.
}
