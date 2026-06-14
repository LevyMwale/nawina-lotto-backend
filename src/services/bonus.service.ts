import { transaction } from 'objection';
import { v4 as uuidv4 } from 'uuid';
import { Wallet } from '../models/Wallet';
import { Transaction } from '../models/Transaction';
import { BonusWagering } from '../models/BonusWagering';
import { User } from '../models/User';
import { Marketer } from '../models/Marketer';
import { PromotionSetting } from '../models/PromotionSetting';

/**
 * Onboarding bonus settings.
 *
 * These are defaults. Admin can override the percentage, cap, and wagering
 * multiplier via the promotions config endpoints. The values here are used
 * when no admin config exists.
 */
const DEFAULT_BONUS_PERCENT = 0.30;
const DEFAULT_BONUS_CAP = 100;
const DEFAULT_WAGERING_MULTIPLIER = 5;
const DEFAULT_EXPIRY_DAYS = 7;

export interface BonusSettings {
  percent: number;
  cap: number;
  wagering_multiplier: number;
  expiry_days: number;
  enabled: boolean;
}

export class BonusService {
  /**
   * Returns the currently active onboarding-bonus settings.
   *
   * In the first iteration this is read from sensible defaults. A future
   * admin-managed `promotion_settings` row can be added to override these.
   */
  async getSettings(): Promise<BonusSettings> {
    try {
      const row = await PromotionSetting.query().findOne({ key: 'onboarding_bonus' });
      if (row?.value) {
        const v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        return {
          percent: Number(v.percent ?? DEFAULT_BONUS_PERCENT),
          cap: Number(v.cap ?? DEFAULT_BONUS_CAP),
          wagering_multiplier: Number(v.wagering_multiplier ?? DEFAULT_WAGERING_MULTIPLIER),
          expiry_days: Number(v.expiry_days ?? DEFAULT_EXPIRY_DAYS),
          enabled: v.enabled !== false,
        };
      }
    } catch (e) {
      console.warn('[BonusService] Failed to read promotion settings, using defaults:', e);
    }
    return {
      percent: DEFAULT_BONUS_PERCENT,
      cap: DEFAULT_BONUS_CAP,
      wagering_multiplier: DEFAULT_WAGERING_MULTIPLIER,
      expiry_days: DEFAULT_EXPIRY_DAYS,
      enabled: true,
    };
  }

  /**
   * Called inside the deposit-completion transaction. If this is the user's
   * first completed deposit and they were referred by a marketer, credit a
   * locked onboarding bonus.
   *
   * The bonus amount is added to `balance` but immediately locked via
   * `locked_amount`, so the user's *available* balance does not change until
   * the wagering requirement is met.
   */
  async processFirstDepositBonus(
    userId: string,
    depositAmount: number,
    trx?: any
  ): Promise<{
    bonus_credited: boolean;
    bonus_amount?: number;
    bonus_transaction_id?: string;
    wagering_id?: string;
    wagering_required?: number;
  }> {
    const settings = await this.getSettings();
    if (!settings.enabled || depositAmount <= 0) {
      return { bonus_credited: false };
    }

    const doProcess = async (trx: any) => {
      const user = await User.query(trx)
        .findById(userId)
        .withGraphFetched('wallet');

      if (!user || !user.referred_by_marketer_id || !user.wallet) {
        return { bonus_credited: false };
      }

      // Only award on the first completed deposit.
      const completedDeposits = await Transaction.query(trx)
        .where({
          wallet_id: user.wallet.id,
          type: 'deposit',
          status: 'completed',
        })
        .where('amount', '>', 0)
        .count('id as count')
        .first();

      const depositCount = Number((completedDeposits as any)?.count ?? 0);
      if (depositCount > 1) {
        // >1 means this was not the first completed deposit.
        return { bonus_credited: false };
      }

      // Compute bonus amount.
      const rawBonus = depositAmount * settings.percent;
      const bonusAmount = Math.min(rawBonus, settings.cap);
      if (bonusAmount <= 0) {
        return { bonus_credited: false };
      }

      const wageringRequired = bonusAmount * settings.wagering_multiplier;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + settings.expiry_days);

      // Credit bonus to wallet but lock it immediately.
      const wallet = user.wallet;
      const newBalance = Number(wallet.balance) + bonusAmount;
      const newLocked = Number(wallet.locked_amount) + bonusAmount;

      await Wallet.query(trx)
        .patch({
          balance: newBalance,
          locked_amount: newLocked,
        })
        .where({ id: wallet.id });

      const bonusTxn = await Transaction.query(trx).insert({
        wallet_id: wallet.id,
        type: 'bonus',
        amount: bonusAmount,
        balance_before: Number(wallet.balance),
        balance_after: newBalance,
        status: 'completed',
        reference: `BONUS-${uuidv4()}`,
        metadata: {
          bonus_type: 'onboarding',
          referred_by_marketer_id: user.referred_by_marketer_id,
          deposit_amount: depositAmount,
          percent: settings.percent,
          cap: settings.cap,
          wagering_required: wageringRequired,
        },
      });

      const wagering = await BonusWagering.query(trx).insert({
        user_id: userId,
        bonus_transaction_id: bonusTxn.id,
        marketer_id: user.referred_by_marketer_id,
        amount: bonusAmount,
        wagering_required: wageringRequired,
        wagering_completed: 0,
        status: 'active',
        expires_at: expiresAt,
      });

      // Update marketer totals atomically.
      await this.incrementMarketerDeposit(
        trx,
        user.referred_by_marketer_id,
        depositAmount
      );

      return {
        bonus_credited: true,
        bonus_amount: bonusAmount,
        bonus_transaction_id: bonusTxn.id,
        wagering_id: wagering.id,
        wagering_required: wageringRequired,
      };
    };

    if (trx) {
      return await doProcess(trx);
    }
    return await transaction(Wallet.knex(), doProcess);
  }

  /**
   * Track a wager against any active locked bonuses (FIFO). Releases bonuses
   * whose wagering requirement has been satisfied.
   */
  async trackWager(
    userId: string,
    wagerAmount: number,
    trx?: any
  ): Promise<{
    released_bonus_amount: number;
    released_bonus_ids: string[];
  }> {
    if (wagerAmount <= 0) {
      return { released_bonus_amount: 0, released_bonus_ids: [] };
    }

    const doTrack = async (trx: any) => {
      const activeBonuses = await BonusWagering.query(trx)
        .where({ user_id: userId, status: 'active' })
        .orderBy('created_at', 'asc');

      let remainingWager = wagerAmount;
      const releasedIds: string[] = [];
      let releasedAmount = 0;

      for (const bonus of activeBonuses) {
        if (remainingWager <= 0) break;

        const completed = Number(bonus.wagering_completed) + remainingWager;
        const required = Number(bonus.wagering_required);

        if (completed >= required) {
          // Release this bonus.
          await this.releaseBonus(trx, bonus.id);
          releasedIds.push(bonus.id);
          releasedAmount += Number(bonus.amount);
          remainingWager = completed - required;
        } else {
          await BonusWagering.query(trx)
            .patch({
              wagering_completed: completed,
              updated_at: new Date(),
            })
            .where({ id: bonus.id });
          remainingWager = 0;
        }
      }

      return {
        released_bonus_amount: releasedAmount,
        released_bonus_ids: releasedIds,
      };
    };

    if (trx) {
      return await doTrack(trx);
    }
    return await transaction(BonusWagering.knex(), doTrack);
  }

  /**
   * Release a locked bonus: reduce locked_amount so the funds become
   * available for withdrawal.
   */
  private async releaseBonus(trx: any, wageringId: string): Promise<void> {
    const wagering = await BonusWagering.query(trx)
      .findById(wageringId)
      .findById(wageringId);

    if (!wagering || wagering.status !== 'active') {
      return;
    }

    const wallet = await Wallet.query(trx)
      .findOne({ user_id: wagering.user_id })
      .forUpdate();

    if (!wallet) {
      return;
    }

    const releaseAmount = Number(wagering.amount);
    const newLocked = Math.max(
      0,
      Number(wallet.locked_amount) - releaseAmount
    );

    await Wallet.query(trx)
      .patch({
        locked_amount: newLocked,
      })
      .where({ id: wallet.id });

    await BonusWagering.query(trx)
      .patch({
        status: 'released',
        wagering_completed: wagering.wagering_required,
        released_at: new Date(),
        updated_at: new Date(),
      })
      .where({ id: wagering.id });
  }

  /**
   * Increment a marketer's running totals for referred first deposits.
   */
  private async incrementMarketerDeposit(
    trx: any,
    marketerId: string,
    depositAmount: number
  ): Promise<void> {
    await Marketer.query(trx)
      .where({ id: marketerId })
      .increment('total_deposits', depositAmount);
  }

  /**
   * Forfeit expired active bonuses. Should be called from a cron job or
   * during login/wallet refresh.
   */
  async forfeitExpiredBonuses(): Promise<number> {
    const now = new Date();
    const expired = await BonusWagering.query()
      .where({ status: 'active' })
      .where('expires_at', '<', now);

    let forfeited = 0;
    for (const bonus of expired) {
      await transaction(BonusWagering.knex(), async (trx) => {
        const wallet = await Wallet.query(trx)
          .findOne({ user_id: bonus.user_id })
          .forUpdate();
        if (wallet) {
          const newLocked = Math.max(
            0,
            Number(wallet.locked_amount) - Number(bonus.amount)
          );
          await Wallet.query(trx)
            .patch({ locked_amount: newLocked })
            .where({ id: wallet.id });
        }
        await BonusWagering.query(trx)
          .patch({ status: 'forfeited', updated_at: new Date() })
          .where({ id: bonus.id });
      });
      forfeited++;
    }

    return forfeited;
  }

  /**
   * Public summary of a user's active/locked bonuses.
   */
  async getUserBonusSummary(userId: string) {
    const bonuses = await BonusWagering.query()
      .where({ user_id: userId })
      .orderBy('created_at', 'desc');

    const active = bonuses.filter((b) => b.status === 'active');
    const released = bonuses.filter((b) => b.status === 'released');
    const forfeited = bonuses.filter((b) => b.status === 'forfeited');

    return {
      active_count: active.length,
      active_locked_amount: active.reduce(
        (sum, b) => sum + Number(b.amount),
        0
      ),
      total_wagering_required: active.reduce(
        (sum, b) => sum + Number(b.wagering_required),
        0
      ),
      total_wagering_completed: active.reduce(
        (sum, b) => sum + Number(b.wagering_completed),
        0
      ),
      released_amount: released.reduce((sum, b) => sum + Number(b.amount), 0),
      forfeited_amount: forfeited.reduce(
        (sum, b) => sum + Number(b.amount),
        0
      ),
      bonuses: bonuses.map((b) => ({
        id: b.id,
        amount: Number(b.amount),
        wagering_required: Number(b.wagering_required),
        wagering_completed: Number(b.wagering_completed),
        status: b.status,
        expires_at: b.expires_at,
        released_at: b.released_at,
      })),
    };
  }
}

