"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seed = seed;
async function seed(knex) {
    // Delete existing entries
    await knex('game_configs').del();
    // Insert game configurations
    await knex('game_configs').insert([
        {
            game_type: 'spin_wheel',
            odds_config: JSON.stringify({
                lose: { probability: 0.50, multiplier: 0, label: 'Try Again' },
                small: { probability: 0.25, multiplier: 1, label: '1x Win' },
                medium: { probability: 0.15, multiplier: 2, label: '2x Win' },
                big: { probability: 0.08, multiplier: 5, label: '5x Win' },
                jackpot: { probability: 0.02, multiplier: 50, label: 'JACKPOT!' },
            }),
            payout_config: JSON.stringify({
                max_payout: 5000,
                max_daily_win_per_user: 10000,
            }),
            min_stake: 5,
            max_stake: 100,
            is_active: true,
        },
        {
            game_type: 'dice_roll',
            odds_config: JSON.stringify({
                exact: { probability: 0.1667, multiplier: 6 },
                even_odd: { probability: 0.50, multiplier: 2 },
                high_low: { probability: 0.50, multiplier: 2 },
            }),
            payout_config: JSON.stringify({
                max_payout: 600,
            }),
            min_stake: 5,
            max_stake: 100,
            is_active: true,
        },
        {
            game_type: 'lotto_pick3',
            odds_config: JSON.stringify({
                match_3: { probability: 0.001, multiplier: 500 },
                match_2: { probability: 0.027, multiplier: 10 },
                match_1: { probability: 0.243, multiplier: 1 },
            }),
            payout_config: JSON.stringify({
                jackpot: 5000,
            }),
            min_stake: 10,
            max_stake: 10,
            is_active: true,
        },
        {
            game_type: 'lotto_pick5',
            odds_config: JSON.stringify({
                match_5: { probability: 0.00000005, multiplier: 5000 },
                match_4: { probability: 0.000097, multiplier: 250 },
                match_3: { probability: 0.0097, multiplier: 25 },
                match_2: { probability: 0.132, multiplier: 2.5 },
            }),
            payout_config: JSON.stringify({
                jackpot: 100000,
            }),
            min_stake: 20,
            max_stake: 20,
            is_active: true,
        },
    ]);
}
//# sourceMappingURL=001_game_configs.js.map