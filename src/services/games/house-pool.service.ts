import { Transaction } from '../../models/Transaction';

/**
 * Global House Pool Service
 *
 * Tracks the total deposits and total wins within a rolling 24-hour window.
 * The house budget available for payouts is 30% of all deposits in that window
 * minus total wins already paid out.
 *
 * When a payout exceeds the available budget, it is CAPPED to the budget
 * rather than forced to zero — players can still win, just not more than
 * the house can afford.
 *
 * A MIN_BUDGET floor ensures small wins are always possible even when
 * deposit activity is low.
 */
export class HousePoolService {
  private static readonly WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours (was 5 min)
  private static readonly POOL_PERCENTAGE = 0.30;          // 30% of deposits
  private static readonly MIN_BUDGET = 50;                  // K50 floor

  /**
   * Return the current global pool status.
   */
  async getPoolStatus(): Promise<{
    totalDeposits: number;
    totalWins: number;
    availableBudget: number;
    isExhausted: boolean;
  }> {
    const knex = Transaction.knex();
    const since = new Date(Date.now() - HousePoolService.WINDOW_MS).toISOString();

    const depositRes = await knex.raw(
      `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM transactions
      WHERE type = 'deposit' AND status = 'completed' AND created_at >= ?
      `,
      [since],
    );
    const totalDeposits = Number(depositRes.rows[0].total);

    const winRes = await knex.raw(
      `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM transactions
      WHERE type = 'win' AND status = 'completed' AND created_at >= ?
      `,
      [since],
    );
    const totalWins = Number(winRes.rows[0].total);

    const availableBudget = Math.max(
      HousePoolService.MIN_BUDGET,
      totalDeposits * HousePoolService.POOL_PERCENTAGE - totalWins,
    );
    const isExhausted = availableBudget <= HousePoolService.MIN_BUDGET;

    return { totalDeposits, totalWins, availableBudget, isExhausted };
  }

  /**
   * Cap a potential payout to what the pool can afford.
   * Never returns 0 unless the payout itself is 0 — just clamps to budget.
   */
  async capPayout(potentialPayout: number): Promise<number> {
    if (potentialPayout <= 0) return 0;
    const { availableBudget } = await this.getPoolStatus();
    return Math.min(potentialPayout, availableBudget);
  }

  /**
   * Check whether the pool is at the minimum floor (very low).
   */
  async isExhausted(): Promise<boolean> {
    const { isExhausted } = await this.getPoolStatus();
    return isExhausted;
  }
}
