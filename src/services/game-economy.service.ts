import { GameConfig } from '../models/GameConfig';

export interface GameOutcome {
  key: string;
  multiplier: number;
  label: string;
  probability?: number;
}

export interface EconomyConfig {
  target_rtp: number;
  target_house_margin: number;
  distribution_strategy: 'default' | 'frequent_small_wins';
  max_daily_payout: number;
  max_win_per_user_per_day: number;
  advertised_rtp?: number;
}

export interface DisplayConfig {
  title?: string;
  subtitle?: string;
  show_rtp?: boolean;
  show_max_win?: boolean;
  accent_color?: string;
}

export interface ResolvedGameConfig {
  game_type: string;
  min_stake: number;
  max_stake: number;
  is_active: boolean;
  economy: EconomyConfig;
  display: DisplayConfig;
  outcomes: GameOutcome[];
  description?: string;
  rules_text?: string;
  sort_order: number;
}

const DEFAULT_ECONOMY: EconomyConfig = {
  target_rtp: 0.35,
  target_house_margin: 0.65,
  distribution_strategy: 'frequent_small_wins',
  max_daily_payout: 50000,
  max_win_per_user_per_day: 10000,
};

const DEFAULT_DISPLAY: DisplayConfig = {
  show_rtp: true,
  show_max_win: true,
};

/**
 * Central game-economy service.
 *
 * Reads per-game configuration from `game_configs`, fills in sensible defaults,
 * and provides helpers for outcome selection, RTP calculation, and fair-play
 * disclosure.
 *
 * The default target is 35% RTP / 65% house margin. Admin can adjust each
 * game's odds_config / payout_config via the admin dashboard.
 */
export class GameEconomyService {
  async getConfig(gameType: string): Promise<ResolvedGameConfig> {
    const dbConfig = await GameConfig.query().findOne({
      game_type: gameType,
      is_active: true,
    });

    if (!dbConfig) {
      throw new Error(`Game config not found or inactive: ${gameType}`);
    }

    const economy: EconomyConfig = {
      ...DEFAULT_ECONOMY,
      ...(dbConfig.economy_config || {}),
    };

    const display: DisplayConfig = {
      ...DEFAULT_DISPLAY,
      ...(dbConfig.display_config || {}),
    };

    const outcomes: GameOutcome[] = Array.isArray(dbConfig.odds_config)
      ? dbConfig.odds_config
      : this.objectToOutcomes(dbConfig.odds_config || {});

    return {
      game_type: dbConfig.game_type,
      min_stake: Number(dbConfig.min_stake),
      max_stake: Number(dbConfig.max_stake),
      is_active: dbConfig.is_active,
      economy,
      display,
      outcomes,
      description: dbConfig.description || undefined,
      rules_text: dbConfig.rules_text || undefined,
      sort_order: Number(dbConfig.sort_order ?? 0),
    };
  }

  /**
   * Convert the legacy object-shaped odds_config into an ordered outcome list.
   */
  private objectToOutcomes(config: Record<string, any>): GameOutcome[] {
    return Object.entries(config).map(([key, value]) => ({
      key,
      multiplier: Number(value.multiplier ?? value.payout ?? 0),
      label: value.label || key,
      probability: value.probability != null ? Number(value.probability) : undefined,
    }));
  }

  /**
   * Select an outcome using the provided random number in [0, 1).
   * Falls back to uniform distribution if probabilities are not supplied.
   */
  determineOutcome(random: number, outcomes: GameOutcome[]): GameOutcome {
    const totalProbability = outcomes.reduce(
      (sum, o) => sum + (o.probability ?? 0),
      0
    );

    if (totalProbability > 0) {
      let cumulative = 0;
      for (const outcome of outcomes) {
        cumulative += outcome.probability ?? 0;
        if (random < cumulative) {
          return outcome;
        }
      }
      return outcomes[outcomes.length - 1];
    }

    // Uniform fallback.
    const index = Math.floor(random * outcomes.length);
    return outcomes[index % outcomes.length];
  }

  /**
   * Compute the mathematical RTP from the configured outcome probabilities.
   */
  calculateRTP(outcomes: GameOutcome[]): number {
    const totalProbability = outcomes.reduce(
      (sum, o) => sum + (o.probability ?? 0),
      0
    );

    if (totalProbability <= 0) {
      return 0;
    }

    return outcomes.reduce(
      (sum, o) => sum + (o.probability ?? 0) * o.multiplier,
      0
    );
  }

  /**
   * Public disclosure payload for the frontend game-info panel.
   */
  async getDisplayInfo(gameType: string): Promise<{
    game_type: string;
    title?: string;
    subtitle?: string;
    description?: string;
    rules_text?: string;
    min_stake: number;
    max_stake: number;
    rtp: string;
    house_margin: string;
    max_multiplier: number;
    max_win: number;
    is_active: boolean;
  }> {
    const config = await this.getConfig(gameType);
    const rtp = this.calculateRTP(config.outcomes);
    const maxMultiplier = Math.max(
      ...config.outcomes.map((o) => o.multiplier),
      0
    );

    // Some games (blackjack, aviator, quiz, soccer) have custom payout
    // mechanics that can't be reduced to a single probability table. Use the
    // operator-reviewed advertised RTP when available; fall back to the
    // mathematical RTP computed from the odds table.
    const effectiveRtp = config.economy.advertised_rtp ?? rtp;

    return {
      game_type: config.game_type,
      title: config.display.title,
      subtitle: config.display.subtitle,
      description: config.description,
      rules_text: config.rules_text,
      min_stake: config.min_stake,
      max_stake: config.max_stake,
      rtp: `${(effectiveRtp * 100).toFixed(1)}%`,
      house_margin: `${((1 - effectiveRtp) * 100).toFixed(1)}%`,
      max_multiplier: maxMultiplier,
      max_win: config.max_stake * maxMultiplier,
      is_active: config.is_active,
    };
  }

  /**
   * Clamp a potential win to the configured per-user daily win limit and
   * global daily payout limit. These are guardrails, not the primary profit
   * driver.
   */
  async applyWinLimits(
    userId: string,
    potentialPayout: number,
    gameType: string
  ): Promise<number> {
    const config = await this.getConfig(gameType);
    const { economy } = config;

    // Per-user daily win limit.
    const knex = GameConfig.knex();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const userWinRes = await knex.raw(
      `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM transactions
      WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id = ?)
        AND type = 'win'
        AND status = 'completed'
        AND created_at >= ?
      `,
      [userId, since]
    );
    const userWinsToday = Number(userWinRes.rows[0].total);
    const remainingUserLimit = Math.max(
      0,
      economy.max_win_per_user_per_day - userWinsToday
    );

    const globalWinRes = await knex.raw(
      `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM transactions
      WHERE type = 'win'
        AND status = 'completed'
        AND created_at >= ?
      `,
      [since]
    );
    const globalWinsToday = Number(globalWinRes.rows[0].total);
    const remainingGlobalLimit = Math.max(
      0,
      economy.max_daily_payout - globalWinsToday
    );

    return Math.min(potentialPayout, remainingUserLimit, remainingGlobalLimit);
  }
}
