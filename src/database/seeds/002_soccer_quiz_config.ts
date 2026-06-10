import { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  // Idempotent: only insert if not already present. Re-runs of `knex seed:run`
  // shouldn't fail with a unique-constraint violation, and overwriting an
  // existing row would clobber any admin-tuned values.
  const existing = await knex('game_configs')
    .where({ game_type: 'soccer_quiz' })
    .first();
  if (existing) return;

  await knex('game_configs').insert({
    game_type: 'soccer_quiz',
    // The question generator is deterministic per fixture, so there isn't
    // a "probability table" the way spin/dice/lotto have. We store the
    // multiplier table the service reads (see soccer.service.ts
    // DEFAULT_CONFIG / getQuizConfig) as JSON for visibility.
    odds_config: JSON.stringify({
      correct: { multiplier: 2, label: 'Correct' },
      wrong:   { multiplier: 0, label: 'Wrong' },
    }),
    payout_config: JSON.stringify({
      // No hard cap beyond the 2× stake × max_stake (1000). Set an
      // explicit ceiling so an admin can tune it without code.
      max_payout: 1000,
    }),
    min_stake: 2,
    max_stake: 500,
    is_active: true,
  });
}
