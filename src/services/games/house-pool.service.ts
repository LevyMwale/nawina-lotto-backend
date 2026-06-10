import { Transaction } from '../../models/Transaction';

/**
 * Global House Pool Service
 *
 * Tracks the total deposits and total wins within a rolling 5-minute window.
 * The house budget available for payouts is 30% of all deposits in that window
 * minus total wins already paid out in the same window.
 *
 * When the budget is exhausted (<= 0), ALL games must force a loss outcome.
 * Game services query this before crediting any win.
 */
export class HousePoolService {
  private static readonly WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly POOL_PERCENTAGE = 0.30;     // 30% of deposits

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
      0,
      totalDeposits * HousePoolService.POOL_PERCENTAGE - totalWins,
    );
    const isExhausted = availableBudget <= 0;

    return { totalDeposits, totalWins, availableBudget, isExhausted };
  }

  /**
   * Check whether the pool can cover a specific payout.
   */
  async canPayOut(potentialPayout: number): Promise<boolean> {
    const { availableBudget } = await this.getPoolStatus();
    return availableBudget >= potentialPayout;
  }

  /**
   * Check whether the pool is exhausted.
   */
  async isExhausted(): Promise<boolean> {
    const { isExhausted } = await this.getPoolStatus();
    return isExhausted;
  }
}
