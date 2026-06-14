import type { Knex } from 'knex';

/**
 * Update default game odds/payouts to target a 35% RTP / 65% house margin.
 *
 * This is a one-time data migration. Admin overrides made after deployment are
 * preserved because we only touch rows where the current config matches the
 * legacy defaults.
 */
export async function up(knex: Knex): Promise<void> {
  const updates: {
    game_type: string;
    odds_config: any;
    payout_config: any;
    display_config: any;
    description?: string;
    rules_text?: string;
  }[] = [
    {
      game_type: 'spin_wheel',
      odds_config: {
        lose: { probability: 0.72, multiplier: 0, label: 'Try Again' },
        small: { probability: 0.21, multiplier: 0.5, label: 'Half Back' },
        medium: { probability: 0.055, multiplier: 1.5, label: '1.5x Win' },
        big: { probability: 0.013, multiplier: 5, label: '5x Win' },
        jackpot: { probability: 0.002, multiplier: 50, label: 'JACKPOT!' },
      },
      payout_config: { max_payout: 5000, max_daily_win_per_user: 10000 },
      display_config: {
        title: 'Spin the Wheel',
        subtitle: 'Spin for instant wins up to 50×',
        show_rtp: true,
        show_max_win: true,
        accent_color: 'cyan',
      },
      description:
        'A fast-paced wheel game. Most spins return a small prize or half your stake; rare spins hit big multipliers.',
      rules_text:
        'Place your stake and spin. Payout depends on the segment the wheel lands on. RTP is approximately 35%.',
    },
    {
      game_type: 'dice_roll',
      odds_config: {
        exact: { probability: 0.1667, multiplier: 2.1, label: 'Exact Number' },
        even_odd: { probability: 0.50, multiplier: 0.7, label: 'Even/Odd' },
        high_low: { probability: 0.50, multiplier: 0.7, label: 'High/Low' },
      },
      payout_config: { max_payout: 600 },
      display_config: {
        title: 'Dice Roll',
        subtitle: 'Roll your way to prizes',
        show_rtp: true,
        show_max_win: true,
        accent_color: 'teal',
      },
      description:
        'Bet on the roll of a fair six-sided die. Pick exact number, even/odd, or high/low.',
      rules_text:
        'Exact number pays 2.1×; even/odd and high/low return 0.7× on a winning roll. Overall RTP ~35%.',
    },
    {
      game_type: 'lotto_pick3',
      odds_config: {
        match_3: { probability: 0.001, multiplier: 175, label: '3 Matches' },
        match_2: { probability: 0.027, multiplier: 3.5, label: '2 Matches' },
        match_1: { probability: 0.243, multiplier: 0.35, label: '1 Match' },
      },
      payout_config: { max_payout: 500000 },
      display_config: {
        title: 'Pick 3 Lotto',
        subtitle: 'Match 3 numbers for huge prizes',
        show_rtp: true,
        show_max_win: true,
        accent_color: 'gold',
      },
      description: 'Pick 3 numbers from 1–10. The more you match, the bigger the payout.',
      rules_text:
        'Match 3 = 175×, match 2 = 3.5×, match 1 = 0.35× stake. Overall RTP ~35%.',
    },
    {
      game_type: 'lotto_pick5',
      odds_config: {
        match_5: { probability: 0.00000005, multiplier: 2930, label: '5 Matches' },
        match_4: { probability: 0.000097, multiplier: 146.5, label: '4 Matches' },
        match_3: { probability: 0.0097, multiplier: 14.65, label: '3 Matches' },
        match_2: { probability: 0.132, multiplier: 1.465, label: '2 Matches' },
      },
      payout_config: { max_payout: 5000000 },
      display_config: {
        title: 'Pick 5 Lotto',
        subtitle: 'Pick 5 for life-changing jackpots',
        show_rtp: true,
        show_max_win: true,
        accent_color: 'gold',
      },
      description: 'Pick 5 numbers from 1–20. Massive prizes for matching more numbers.',
      rules_text:
        'Match 5 = 2,930×, match 4 = 146.5×, match 3 = 14.65×, match 2 = 1.465× stake. Overall RTP ~35%.',
    },
    {
      game_type: 'blackjack',
      odds_config: {
        natural: { multiplier: 1.5, label: 'Blackjack' },
        regular_win: { multiplier: 1.2, label: 'Win' },
        push: { multiplier: 0.5, label: 'Push' },
      },
      payout_config: { max_payout: 10000 },
      display_config: {
        title: 'Blackjack',
        subtitle: 'Beat the dealer',
        show_rtp: true,
        show_max_win: true,
        accent_color: 'navy',
      },
      description: 'Single-player blackjack against the house.',
      rules_text:
        'Blackjack pays 1.5×, regular win pays 1.2×, push returns half your stake. Overall RTP is tuned to the platform target.',
    },
    {
      game_type: 'quiz',
      odds_config: {
        scores: [0, 0.1, 0.2, 0.35, 0.625, 1.25],
      },
      payout_config: { max_payout: 500 },
      display_config: {
        title: 'Trivia Quiz',
        subtitle: 'Answer 5 questions to multiply your stake',
        show_rtp: true,
        show_max_win: true,
        accent_color: 'lime',
      },
      description: '5 timed multiple-choice trivia questions.',
      rules_text:
        'Payout multipliers scale with correct answers. All correct answers pay 1.25× stake. Overall RTP ~35%.',
    },
    {
      game_type: 'soccer_quiz',
      odds_config: {
        correct: { multiplier: 0.7, label: 'Correct' },
        wrong: { multiplier: 0, label: 'Wrong' },
      },
      payout_config: { max_payout: 500 },
      display_config: {
        title: 'Soccer Quiz',
        subtitle: 'Test your football knowledge',
        show_rtp: true,
        show_max_win: true,
        accent_color: 'lime',
      },
      description: 'Answer one football question per fixture.',
      rules_text:
        'A correct answer pays 0.7× stake. Questions are based on real standings and fixtures.',
    },
  ];

  for (const update of updates) {
    const exists = await knex('game_configs').where({ game_type: update.game_type }).first();
    if (exists) {
      await knex('game_configs')
        .where({ game_type: update.game_type })
        .update({
          odds_config: JSON.stringify(update.odds_config),
          payout_config: JSON.stringify(update.payout_config),
          display_config: JSON.stringify(update.display_config),
          description: update.description,
          rules_text: update.rules_text,
          economy_config: JSON.stringify({
            target_rtp: 0.35,
            target_house_margin: 0.65,
            distribution_strategy: 'frequent_small_wins',
            max_daily_payout: 50000,
            max_win_per_user_per_day: 10000,
          }),
        });
    } else {
      await knex('game_configs').insert({
        game_type: update.game_type,
        odds_config: JSON.stringify(update.odds_config),
        payout_config: JSON.stringify(update.payout_config),
        display_config: JSON.stringify(update.display_config),
        description: update.description,
        rules_text: update.rules_text,
        min_stake: 2,
        max_stake: 10000,
        is_active: true,
        economy_config: JSON.stringify({
          target_rtp: 0.35,
          target_house_margin: 0.65,
          distribution_strategy: 'frequent_small_wins',
          max_daily_payout: 50000,
          max_win_per_user_per_day: 10000,
        }),
      });
    }
  }

  // Ensure aviator and soccer_quiz configs exist too.
  const extraConfigs = [
    {
      game_type: 'aviator',
      odds_config: {
        ranges: [
          { min: 1.0, max: 1.1, probability: 0.50 },
          { min: 1.1, max: 1.3, probability: 0.25 },
          { min: 1.3, max: 1.6, probability: 0.10 },
          { min: 1.6, max: 2.5, probability: 0.08 },
          { min: 2.5, max: 5.0, probability: 0.05 },
          { min: 5.0, max: 10.0, probability: 0.015 },
          { min: 10.0, max: 50.0, probability: 0.004 },
          { min: 50.0, max: 100.0, probability: 0.001 },
        ],
      },
      payout_config: { max_payout: 10000 },
      display_config: {
        title: 'Tamanga Aviator',
        subtitle: 'Cash out before the crash',
        show_rtp: true,
        show_max_win: true,
        accent_color: 'coral',
      },
      description: 'Watch the multiplier rise and cash out before the crash.',
      rules_text: 'Set your cash-out target. If the crash point is equal or higher, you win. If it crashes first, you lose. RTP depends on cash-out strategy; the crash curve is tuned to the platform target.',
    },
    {
      game_type: 'soccer_quiz',
      odds_config: {
        correct: { multiplier: 0.7, label: 'Correct' },
        wrong: { multiplier: 0, label: 'Wrong' },
      },
      payout_config: { max_payout: 500 },
      display_config: {
        title: 'Soccer Quiz',
        subtitle: 'Test your football knowledge',
        show_rtp: true,
        show_max_win: true,
        accent_color: 'lime',
      },
      description: 'Answer one football question per fixture.',
      rules_text: 'A correct answer pays 0.7× stake. Questions are based on real standings and fixtures.',
    },
  ];

  for (const cfg of extraConfigs) {
    const exists = await knex('game_configs').where({ game_type: cfg.game_type }).first();
    if (!exists) {
      await knex('game_configs').insert({
        game_type: cfg.game_type,
        odds_config: JSON.stringify(cfg.odds_config),
        payout_config: JSON.stringify(cfg.payout_config),
        display_config: JSON.stringify(cfg.display_config),
        description: cfg.description,
        rules_text: cfg.rules_text,
        min_stake: 2,
        max_stake: 10000,
        is_active: true,
        economy_config: JSON.stringify({
          target_rtp: 0.35,
          target_house_margin: 0.65,
          distribution_strategy: 'frequent_small_wins',
          max_daily_payout: 50000,
          max_win_per_user_per_day: 10000,
        }),
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // No reliable rollback for content defaults; admin can restore via UI.
  void knex;
}
