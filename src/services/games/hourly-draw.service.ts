import { transaction } from 'objection';
import { HourlyDraw } from '../../models/HourlyDraw';
import { HourlyDrawEntry } from '../../models/HourlyDrawEntry';
import { WalletService } from '../wallet.service';
import { RNGService } from '../rng.service';
import { GamePlay } from '../../models/GamePlay';
import { HousePoolService } from './house-pool.service';

const walletService = new WalletService();
const rngService = new RNGService();

/**
 * Daily Draw Service
 *
 * Draws run twice daily:
 *   - Morning draw: 08:00 AM
 *   - Evening draw: 18:00 PM (6:00 PM)
 *
 * The admin can set a fixed prize amount (`admin_prize_pool`) on any open
 * draw. When the draw executes, the winner receives that amount. If no admin
 * prize is set, the draw falls back to the pooled ticket-sales model (80% of
 * total pool goes to the winner).
 */

const DRAW_TIMES = [8, 18]; // hours of the day (08:00 and 18:00)
const DEFAULT_TICKET_PRICE = 2;
const POOL_PERCENTAGE = 0.80;

function getNextDrawTime(now = new Date()): Date {
  const currentHour = now.getHours();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  // Find the next draw time today
  const nextToday = DRAW_TIMES.find((h) => h > currentHour);
  if (nextToday !== undefined) {
    return new Date(today.getTime() + nextToday * 60 * 60 * 1000);
  }

  // All draws for today have passed — go to first draw tomorrow
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  return new Date(tomorrow.getTime() + DRAW_TIMES[0] * 60 * 60 * 1000);
}

function getCurrentOrPreviousDrawTime(now = new Date()): Date {
  const currentHour = now.getHours();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  // Find the most recent draw time that has already passed or is now
  const passed = DRAW_TIMES.filter((h) => h <= currentHour);
  if (passed.length > 0) {
    const hour = passed[passed.length - 1];
    return new Date(today.getTime() + hour * 60 * 60 * 1000);
  }

  // No draw passed yet today — the most recent draw was yesterday evening (18:00)
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  return new Date(yesterday.getTime() + DRAW_TIMES[1] * 60 * 60 * 1000);
}

export class HourlyDrawService {
  /**
   * Create the next upcoming draw if it doesn't already exist.
   */
  async createNextDraw(): Promise<HourlyDraw> {
    const nextTime = getNextDrawTime();

    const existing = await HourlyDraw.query()
      .where('scheduled_at', nextTime.toISOString())
      .first();

    if (existing) {
      return existing;
    }

    return await HourlyDraw.query().insert({
      scheduled_at: nextTime,
      status: 'open',
      ticket_price: DEFAULT_TICKET_PRICE,
      total_pool: 0,
      prize_pool: 0,
      house_edge_amount: 0,
    });
  }

  /**
   * Seed the current or most-recent draw on boot (in case server was down).
   */
  async seedCurrentDraw(): Promise<HourlyDraw> {
    const currentTime = getCurrentOrPreviousDrawTime();

    const existing = await HourlyDraw.query()
      .where('scheduled_at', currentTime.toISOString())
      .first();

    if (existing) {
      return existing;
    }

    return await HourlyDraw.query().insert({
      scheduled_at: currentTime,
      status: 'open',
      ticket_price: DEFAULT_TICKET_PRICE,
      total_pool: 0,
      prize_pool: 0,
      house_edge_amount: 0,
    });
  }

  /**
   * Set (or update) the admin prize pool for an open draw.
   */
  async setPrize(drawId: string, prizeAmount: number): Promise<HourlyDraw> {
    if (prizeAmount <= 0) {
      throw new Error('Prize amount must be positive');
    }

    const draw = await HourlyDraw.query().findById(drawId);
    if (!draw) {
      throw new Error('Draw not found');
    }
    if (draw.status !== 'open') {
      throw new Error('Can only set prize on open draws');
    }

    await HourlyDraw.query()
      .patch({ admin_prize_pool: prizeAmount })
      .where({ id: drawId });

    const updated = await HourlyDraw.query().findById(drawId);
    if (!updated) throw new Error('Draw disappeared after update');
    return updated;
  }

  /**
   * Buy ticket(s) for the current open draw.
   */
  async buyTicket(
    userId: string,
    drawId: string,
    ticketCount: number = 1
  ): Promise<{
    success: boolean;
    draw_id: string;
    ticket_numbers: number[];
    total_cost: number;
    balance: number;
  }> {
    if (ticketCount < 1 || ticketCount > 100) {
      throw new Error('Ticket count must be between 1 and 100');
    }

    const draw = await HourlyDraw.query().findById(drawId);
    if (!draw) {
      throw new Error('Draw not found');
    }
    if (draw.status !== 'open') {
      throw new Error('This draw is no longer open for entries');
    }

    const ticketPrice = Number(draw.ticket_price);
    const totalCost = ticketPrice * ticketCount;

    return await transaction(HourlyDraw.knex(), async (trx) => {
      // 1. Deduct total cost from user wallet
      const deductResult = await walletService.deduct(userId, totalCost, 'purchase', {
        game_type: 'hourly_draw',
        draw_id: drawId,
        ticket_count: ticketCount,
      });

      // 2. Find the highest existing ticket number for this draw
      const lastEntry = await HourlyDrawEntry.query(trx)
        .where({ draw_id: drawId })
        .orderBy('ticket_number', 'desc')
        .first();

      const startNumber = lastEntry ? lastEntry.ticket_number + 1 : 1;

      // 3. Insert entries
      const ticketNumbers: number[] = [];
      for (let i = 0; i < ticketCount; i++) {
        const ticketNum = startNumber + i;
        await HourlyDrawEntry.query(trx).insert({
          draw_id: drawId,
          user_id: userId,
          ticket_number: ticketNum,
          amount_paid: ticketPrice,
        });
        ticketNumbers.push(ticketNum);
      }

      // 4. Update draw pool totals
      const newTotalPool = Number(draw.total_pool) + totalCost;
      const newPrizePool = newTotalPool * POOL_PERCENTAGE;
      const newHouseEdge = newTotalPool - newPrizePool;

      await HourlyDraw.query(trx)
        .patch({
          total_pool: newTotalPool,
          prize_pool: newPrizePool,
          house_edge_amount: newHouseEdge,
        })
        .where({ id: drawId });

      // 5. Record game_play for audit trail
      await GamePlay.query(trx).insert({
        user_id: userId,
        game_type: 'hourly_draw',
        stake: totalCost,
        bet_data: { draw_id: drawId, ticket_numbers: ticketNumbers, ticket_price: ticketPrice },
        result: { status: 'entered', draw_id: drawId },
        payout: 0,
        rng_seed: '',
      });

      return {
        success: true,
        draw_id: drawId,
        ticket_numbers: ticketNumbers,
        total_cost: totalCost,
        balance: deductResult.new_balance,
      };
    });
  }

  /**
   * Execute a draw: close it, randomly pick a winning ticket, credit the winner.
   *
   * Prize logic:
   *   - If admin_prize_pool is set > 0, the winner receives that amount.
   *   - Otherwise the winner receives the calculated prize_pool (80% of sales).
   */
  async runDraw(drawId: string): Promise<{
    success: boolean;
    winner_user_id?: string;
    winning_ticket_number?: number;
    prize_pool: number;
    total_entries: number;
  }> {
    const draw = await HourlyDraw.query().findById(drawId);
    if (!draw) {
      throw new Error('Draw not found');
    }
    if (draw.status !== 'open') {
      throw new Error('Draw is not open');
    }

    const entries = await HourlyDrawEntry.query().where({ draw_id: drawId });
    const totalEntries = entries.length;

    // Determine the actual prize amount
    const adminPrize = Number(draw.admin_prize_pool || 0);
    const calculatedPrize = Number(draw.prize_pool || 0);
    let actualPrize = adminPrize > 0 ? adminPrize : calculatedPrize;

    // Global pool check for admin-set prizes (ticket-sales pool is self-funded)
    if (adminPrize > 0) {
      const housePool = new HousePoolService();
      const pool = await housePool.getPoolStatus();
      if (pool.isExhausted || actualPrize > pool.availableBudget) {
        console.log(`[Draw] Admin prize ${actualPrize} exceeds pool budget ${pool.availableBudget}. Capping to 0.`);
        actualPrize = 0;
      }
    }

    if (totalEntries === 0) {
      await HourlyDraw.query()
        .patch({
          status: 'completed',
          completed_at: new Date(),
        })
        .where({ id: drawId });

      return {
        success: true,
        prize_pool: actualPrize,
        total_entries: 0,
      };
    }

    // Close the draw first so no more entries can be bought
    await HourlyDraw.query()
      .patch({ status: 'closed' })
      .where({ id: drawId });

    // RNG pick
    const { seed, value: randomIndex } = rngService.generateRandomInt(0, totalEntries - 1);
    const winningEntry = entries[randomIndex];
    const winningTicketNumber = winningEntry.ticket_number;
    const winnerUserId = winningEntry.user_id;

    // Credit the winner
    if (actualPrize > 0) {
      await walletService.credit(winnerUserId, actualPrize, 'win', {
        game_type: 'hourly_draw',
        draw_id: drawId,
        winning_ticket: winningTicketNumber,
        prize_source: adminPrize > 0 ? 'admin_set' : 'pooled',
      });
    }

    // Mark draw completed
    await HourlyDraw.query()
      .patch({
        status: 'completed',
        winner_user_id: winnerUserId,
        winning_ticket_number: winningTicketNumber,
        rng_seed: seed,
        completed_at: new Date(),
      })
      .where({ id: drawId });

    // Record winning game_play row
    await GamePlay.query().insert({
      user_id: winnerUserId,
      game_type: 'hourly_draw',
      stake: winningEntry.amount_paid,
      bet_data: { draw_id: drawId, ticket_number: winningTicketNumber },
      result: {
        status: 'won',
        draw_id: drawId,
        winning_ticket: winningTicketNumber,
        total_entries: totalEntries,
        prize_pool: actualPrize,
        prize_source: adminPrize > 0 ? 'admin_set' : 'pooled',
      },
      payout: actualPrize,
      rng_seed: seed,
    });

    return {
      success: true,
      winner_user_id: winnerUserId,
      winning_ticket_number: winningTicketNumber,
      prize_pool: actualPrize,
      total_entries: totalEntries,
    };
  }

  /**
   * Get the current open draw (the upcoming 08:00 or 18:00 draw).
   */
  async getCurrentDraw(userId?: string): Promise<{
    draw: HourlyDraw | null;
    total_entries: number;
    user_tickets: number[];
  }> {
    const now = new Date();
    const currentOrPrev = getCurrentOrPreviousDrawTime(now);
    const next = getNextDrawTime(now);

    // Prefer the upcoming draw, but if it doesn't exist yet, show the most recent
    let draw = await HourlyDraw.query()
      .where('scheduled_at', next.toISOString())
      .where('status', 'open')
      .first();

    if (!draw) {
      draw = await HourlyDraw.query()
        .where('scheduled_at', currentOrPrev.toISOString())
        .where('status', 'open')
        .first();
    }

    if (!draw) {
      // Fallback: future open draw only (don't show stale past draws)
      draw = await HourlyDraw.query()
        .where('status', 'open')
        .where('scheduled_at', '>', new Date().toISOString())
        .orderBy('scheduled_at', 'asc')
        .first();
    }

    if (!draw) {
      // Nothing at all — auto-create the upcoming draw so the UI never breaks
      draw = await this.createNextDraw();
    }

    const totalEntries = await HourlyDrawEntry.query()
      .where({ draw_id: draw.id })
      .resultSize();

    let userTickets: number[] = [];
    if (userId) {
      const userEntries = await HourlyDrawEntry.query()
        .where({ draw_id: draw.id, user_id: userId })
        .orderBy('ticket_number', 'asc');
      userTickets = userEntries.map((e: HourlyDrawEntry) => e.ticket_number);
    }

    return {
      draw,
      total_entries: totalEntries,
      user_tickets: userTickets,
    };
  }

  /**
   * Get history of completed draws, newest first.
   */
  async getDrawHistory(limit = 20, offset = 0): Promise<{
    draws: HourlyDraw[];
    total: number;
  }> {
    const query = HourlyDraw.query()
      .where('status', 'completed')
      .orderBy('scheduled_at', 'desc')
      .limit(limit)
      .offset(offset);

    const draws = await query;
    const total = await HourlyDraw.query()
      .where('status', 'completed')
      .resultSize();

    return { draws, total };
  }

  /**
   * Cancel an open draw and refund all entries.
   */
  async cancelDraw(drawId: string, adminId: string): Promise<{
    success: boolean;
    refunded_entries: number;
    total_refunded: number;
  }> {
    const draw = await HourlyDraw.query().findById(drawId);
    if (!draw) {
      throw new Error('Draw not found');
    }
    if (draw.status !== 'open') {
      throw new Error('Only open draws can be cancelled');
    }

    const entries = await HourlyDrawEntry.query().where({ draw_id: drawId });

    return await transaction(HourlyDraw.knex(), async (trx) => {
      let totalRefunded = 0;

      for (const entry of entries) {
        await walletService.credit(entry.user_id, entry.amount_paid, 'refund', {
          game_type: 'hourly_draw',
          draw_id: drawId,
          ticket_number: entry.ticket_number,
          cancelled_by: adminId,
        });
        totalRefunded += Number(entry.amount_paid);
      }

      await HourlyDraw.query(trx)
        .patch({
          status: 'cancelled',
          completed_at: new Date(),
        })
        .where({ id: drawId });

      return {
        success: true,
        refunded_entries: entries.length,
        total_refunded: totalRefunded,
      };
    });
  }
}
