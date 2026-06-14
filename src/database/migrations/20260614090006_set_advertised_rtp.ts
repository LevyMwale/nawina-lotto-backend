import type { Knex } from 'knex';

/**
 * Add an advertised RTP to each game's economy_config so the frontend can
 * show a transparent, operator-reviewed figure instead of deriving it from
 * odds_config shapes that don't map cleanly to every game.
 */
export async function up(knex: Knex): Promise<void> {
  const advertised: Record<string, number> = {
    spin_wheel: 0.35,
    dice_roll: 0.35,
    lotto_pick3: 0.35,
    lotto_pick5: 0.35,
    blackjack: 0.35,
    quiz: 0.35,
    soccer_quiz: 0.35,
    aviator: 0.35,
    draw: 0.35,
  };

  for (const [gameType, rtp] of Object.entries(advertised)) {
    const row = await knex('game_configs').where({ game_type: gameType }).first();
    if (!row) continue;

    const economy = typeof row.economy_config === 'string'
      ? JSON.parse(row.economy_config)
      : (row.economy_config || {});

    economy.advertised_rtp = rtp;

    await knex('game_configs')
      .where({ game_type: gameType })
      .update({ economy_config: JSON.stringify(economy) });
  }
}

export async function down(knex: Knex): Promise<void> {
  const rows = await knex('game_configs').select('game_type', 'economy_config');
  for (const row of rows) {
    const economy = typeof row.economy_config === 'string'
      ? JSON.parse(row.economy_config)
      : (row.economy_config || {});
    delete economy.advertised_rtp;
    await knex('game_configs')
      .where({ game_type: row.game_type })
      .update({ economy_config: JSON.stringify(economy) });
  }
}
