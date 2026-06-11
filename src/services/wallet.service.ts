import { Wallet } from '../models/Wallet';
import { Transaction } from '../models/Transaction';
import { transaction } from 'objection';
import { v4 as uuidv4 } from 'uuid';
import { InvoiceService } from './invoice.service';
import { LipilaService } from './lipila.service';

// Single shared instance — InvoiceService is stateless and we want
// the same in-flight request to use one allocation path.
const invoiceService = new InvoiceService();
const lipilaService = new LipilaService();

export class WalletService {
  async getBalance(userId: string) {
    const wallet = await Wallet.query().findOne({ user_id: userId });

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    return {
      balance: Number(wallet.balance),
      currency: wallet.currency,
      locked_amount: Number(wallet.locked_amount),
      available: Number(wallet.balance) - Number(wallet.locked_amount),
    };
  }

  async deduct(
    userId: string,
    amount: number,
    type: 'bet' | 'purchase',
    metadata?: any,
    trx?: any
  ) {
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    const doDeduct = async (trx: any) => {
      const wallet = await Wallet.query(trx)
        .findOne({ user_id: userId })
        .forUpdate();

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      const availableBalance = Number(wallet.balance) - Number(wallet.locked_amount);
      if (availableBalance < amount) {
        throw new Error('Insufficient balance');
      }

      const newBalance = Number(wallet.balance) - amount;

      await Wallet.query(trx)
        .patch({ balance: newBalance })
        .where({ id: wallet.id });

      const txn = await Transaction.query(trx).insert({
        wallet_id: wallet.id,
        type,
        amount: -amount,
        balance_before: Number(wallet.balance),
        balance_after: newBalance,
        status: 'completed',
        reference: `${type.toUpperCase()}-${uuidv4()}`,
        metadata,
      });

      return {
        transaction_id: txn.id,
        new_balance: newBalance,
      };
    };

    if (trx) {
      return await doDeduct(trx);
    }
    return await transaction(Wallet.knex(), doDeduct);
  }

  async credit(
    userId: string,
    amount: number,
    type: 'win' | 'deposit' | 'refund' | 'bonus',
    metadata?: any,
    trx?: any
  ) {
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    const doCredit = async (trx: any) => {
      const wallet = await Wallet.query(trx)
        .findOne({ user_id: userId })
        .forUpdate();

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      const newBalance = Number(wallet.balance) + amount;

      await Wallet.query(trx)
        .patch({ balance: newBalance })
        .where({ id: wallet.id });

      const txn = await Transaction.query(trx).insert({
        wallet_id: wallet.id,
        type,
        amount,
        balance_before: Number(wallet.balance),
        balance_after: newBalance,
        status: 'completed',
        reference: `${type.toUpperCase()}-${uuidv4()}`,
        metadata,
      });

      // Auto-invoice every deposit. Generated inside the same
      // transaction so a deposit and its invoice are atomic — if the
      // invoice insert fails, the whole deposit rolls back. This is
      // the same atomicity guarantee as a real payment-gateway call.
      let invoice: any = null;
      if (type === 'deposit') {
        invoice = await invoiceService.generateForDeposit(trx, {
          userId,
          transactionId: txn.id,
          amount,
        });
      }

      return {
        transaction_id: txn.id,
        new_balance: newBalance,
        invoice: invoice
          ? {
              id: invoice.id,
              invoice_number: invoice.invoice_number,
              amount: Number(invoice.amount),
              excise_duty: Number(invoice.excise_duty),
              net_amount: Number(invoice.net_amount),
            }
          : null,
      };
    };

    if (trx) {
      return await doCredit(trx);
    }
    return await transaction(Wallet.knex(), doCredit);
  }

  // Deposit method
  async deposit(
    userId: string,
    amount: number,
    method: string,
    details?: { mobileNumber?: string; cardDetails?: any }
  ) {
    // Ensure amount is a proper number
    const depositAmount = Number(amount);

    if (depositAmount < 2) {
      throw new Error('Minimum deposit is K2');
    }

    // Mobile money deposit flow (MTN, Airtel, Zamtel) — all route through Lipila
    if (['lipila', 'mtn', 'airtel', 'zamtel'].includes(method)) {
      if (!details?.mobileNumber) {
        throw new Error('Phone number is required for Lipila deposits');
      }

      const { success, reference, message, lipilaIdentifier } = await lipilaService.initiateDeposit(
        depositAmount,
        details.mobileNumber,
        userId,
      );

      if (!success) {
        throw new Error(message || 'Lipila deposit initiation failed');
      }

      console.log(`[WalletDeposit] Lipila initiated OK — reference=${reference}, lipilaId=${lipilaIdentifier}`);

      const wallet = await Wallet.query().findOne({ user_id: userId });
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      const txn = await Transaction.query().insert({
        wallet_id: wallet.id,
        type: 'deposit',
        amount: depositAmount,
        balance_before: Number(wallet.balance),
        balance_after: Number(wallet.balance),
        status: 'pending',
        reference,
        metadata: {
          payment_method: method,
          gateway: 'lipila',
          lipila_reference: reference,
          lipila_identifier: lipilaIdentifier,
          mobile_number: details.mobileNumber,
        },
      });

      console.log(`[WalletDeposit] Pending transaction created — txnId=${txn.id}, walletId=${wallet.id}, userId=${userId}`);

      return {
        success: true,
        pending: true,
        balance: Number(wallet.balance),
        transactionId: txn.id,
        reference,
        message,
      };
    }

    // TODO: In production, integrate with actual payment gateway here
    // const paymentResult = await this.processPaymentGateway(method, amount, details);
    // if (!paymentResult.success) {
    //   throw new Error('Payment gateway failed');
    // }

    // Use the existing credit method to add funds. The credit step
    // also generates an invoice atomically (same DB transaction) for
    // completed deposits, so we forward the invoice to the caller.
    const result = await this.credit(userId, depositAmount, 'deposit', {
      payment_method: method,
      mobile_number: details?.mobileNumber,
      card_last4: details?.cardDetails?.number?.slice(-4),
      // payment_reference: paymentResult.transactionRef, // Uncomment when using real gateway
    });

    return {
      success: true,
      balance: result.new_balance,
      transactionId: result.transaction_id,
      invoice: result.invoice,
    };
  }

  // Withdraw method
  async withdraw(
    userId: string,
    amount: number,
    method: string,
    details?: { mobileNumber?: string; cardDetails?: any }
  ) {
    if (amount < 10) {
      throw new Error('Minimum withdrawal is K10');
    }

    // Check balance first
    const balanceInfo = await this.getBalance(userId);
    if (balanceInfo.available < amount) {
      throw new Error('Insufficient balance');
    }

    // Mobile money withdrawal flow (MTN, Airtel, Zamtel) — all route through Lipila
    if (['lipila', 'mtn', 'airtel', 'zamtel'].includes(method)) {
      if (!details?.mobileNumber) {
        throw new Error('Phone number is required for Lipila withdrawals');
      }

      const { success, reference, message } = await lipilaService.initiateWithdrawal(
        amount,
        details.mobileNumber,
        userId,
      );

      if (!success) {
        throw new Error(message || 'Lipila withdrawal initiation failed');
      }

      return await transaction(Wallet.knex(), async (trx) => {
        const wallet = await Wallet.query(trx)
          .findOne({ user_id: userId })
          .forUpdate();

        if (!wallet) {
          throw new Error('Wallet not found');
        }

        const newBalance = Number(wallet.balance) - amount;

        await Wallet.query(trx)
          .patch({ balance: newBalance })
          .where({ id: wallet.id });

        const txn = await Transaction.query(trx).insert({
          wallet_id: wallet.id,
          type: 'withdrawal',
          amount: -amount,
          balance_before: Number(wallet.balance),
          balance_after: newBalance,
          status: 'pending',
          reference,
          metadata: {
            withdrawal_method: method,
            gateway: 'lipila',
            lipila_reference: reference,
            mobile_number: details.mobileNumber,
            withdrawal: true,
          },
        });

        return {
          success: true,
          pending: true,
          balance: newBalance,
          transactionId: txn.id,
          reference,
          message,
        };
      });
    }

    // TODO: In production, integrate with actual payment gateway here
    // const paymentResult = await this.processWithdrawalGateway(method, amount, details);
    // if (!paymentResult.success) {
    //   throw new Error('Payment gateway failed');
    // }

    // Use the existing deduct method to remove funds
    const result = await this.deduct(userId, amount, 'purchase', {
      withdrawal_method: method,
      mobile_number: details?.mobileNumber,
      card_last4: details?.cardDetails?.number?.slice(-4),
      withdrawal: true,
      // payment_reference: paymentResult.transactionRef, // Uncomment when using real gateway
    });

    return {
      success: true,
      balance: result.new_balance,
      transactionId: result.transaction_id,
    };
  }

  async getTransactions(userId: string, limit = 50, offset = 0) {
    const wallet = await Wallet.query().findOne({ user_id: userId });

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    const transactions = await Transaction.query()
      .where({ wallet_id: wallet.id })
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return transactions.map((txn: Transaction) => ({
      id: txn.id,
      type: txn.type,
      amount: Number(txn.amount),
      status: txn.status,
      reference: txn.reference,
      created_at: txn.created_at,
    }));
  }

  /**
   * Admin-issued bonus: credits the user's wallet and records a 'bonus' transaction.
   * Returns the new balance and transaction ID.
   */
  async addBonus(
    userId: string,
    amount: number,
    reason: string,
    adminId: string
  ) {
    if (amount <= 0) {
      throw new Error('Bonus amount must be positive');
    }

    return await transaction(Wallet.knex(), async (trx) => {
      const wallet = await Wallet.query(trx)
        .findOne({ user_id: userId })
        .forUpdate();

      if (!wallet) {
        throw new Error('User wallet not found');
      }

      const newBalance = Number(wallet.balance) + amount;

      await Wallet.query(trx)
        .patch({ balance: newBalance })
        .where({ id: wallet.id });

      const txn = await Transaction.query(trx).insert({
        wallet_id: wallet.id,
        type: 'bonus',
        amount,
        balance_before: Number(wallet.balance),
        balance_after: newBalance,
        status: 'completed',
        reference: `BONUS-${uuidv4()}`,
        metadata: { reason, issued_by: adminId },
        approved_by: adminId,
      });

      return {
        transaction_id: txn.id,
        new_balance: newBalance,
      };
    });
  }

  /**
   * Approve a pending withdrawal: marks the transaction completed.
   * The funds were already deducted at withdrawal request time, so we just
   * flip the status.
   */
  async approveWithdrawal(transactionId: string, adminId: string) {
    const txn = await Transaction.query().findById(transactionId);
    if (!txn) {
      throw new Error('Transaction not found');
    }
    if (txn.type !== 'withdrawal') {
      throw new Error('Only withdrawal transactions can be approved');
    }
    if (txn.status !== 'pending') {
      throw new Error(`Transaction is already ${txn.status}`);
    }

    await Transaction.query()
      .patch({ status: 'completed', approved_by: adminId })
      .where({ id: transactionId });

    return { transaction_id: transactionId, status: 'completed' };
  }

  /**
   * Reject a pending withdrawal: marks cancelled and refunds the amount
   * back to the wallet.
   */
  async rejectWithdrawal(transactionId: string, adminId: string, reason?: string) {
    return await transaction(Wallet.knex(), async (trx) => {
      const txn = await Transaction.query(trx).findById(transactionId);
      if (!txn) {
        throw new Error('Transaction not found');
      }
      if (txn.type !== 'withdrawal') {
        throw new Error('Only withdrawal transactions can be rejected');
      }
      if (txn.status !== 'pending') {
        throw new Error(`Transaction is already ${txn.status}`);
      }

      // Refund: credit the wallet
      const wallet = await Wallet.query(trx)
        .findOne({ id: txn.wallet_id })
        .forUpdate();

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      const newBalance = Number(wallet.balance) + Math.abs(Number(txn.amount));

      await Wallet.query(trx)
        .patch({ balance: newBalance })
        .where({ id: wallet.id });

      await Transaction.query(trx)
        .patch({
          status: 'cancelled',
          approved_by: adminId,
          metadata: { ...(txn.metadata || {}), rejection_reason: reason },
        })
        .where({ id: transactionId });

      return { transaction_id: transactionId, status: 'cancelled', new_balance: newBalance };
    });
  }

  /**
   * Poll the status of a Lipila deposit and complete it if confirmed.
   * Returns the current status, and if completed, the new balance + invoice.
   */
  /**
   * Core completion logic — idempotent so it can be called from polling,
   * webhooks, or manual admin completion.
   */
  async completeDepositTransaction(txn: Transaction): Promise<{
    newBalance: number;
    invoice: {
      id: string;
      invoice_number: string;
      amount: number;
      excise_duty: number;
      net_amount: number;
    } | null;
  }> {
    return await transaction(Transaction.knex(), async (trx) => {
      // Re-read the transaction row inside the transaction so we see the
      // latest status (protects against race conditions from webhook + poll).
      const freshTxn = await Transaction.query(trx)
        .findById(txn.id)
        .forUpdate();

      if (!freshTxn) {
        throw new Error('Transaction not found');
      }

      // Use the wallet_id stored on the transaction — this is the source of
      // truth and avoids the bug where a mismatched userId was passed in.
      const wallet = await Wallet.query(trx)
        .findById(freshTxn.wallet_id)
        .forUpdate();

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      // TRUE IDEMPOTENCY: if already completed, return current state without
      // touching the wallet again. This prevents double-credit when webhook
      // and polling call this simultaneously.
      if (freshTxn.status === 'completed') {
        const existingInvoice = await invoiceService.findByTransaction(trx, freshTxn.id);
        return {
          newBalance: Number(wallet.balance),
          invoice: existingInvoice
            ? {
                id: existingInvoice.id,
                invoice_number: existingInvoice.invoice_number,
                amount: Number(existingInvoice.amount),
                excise_duty: Number(existingInvoice.excise_duty),
                net_amount: Number(existingInvoice.net_amount),
              }
            : null,
        };
      }

      const depositAmount = Number(freshTxn.amount);
      const newBalance = Number(wallet.balance) + depositAmount;

      await Wallet.query(trx)
        .patch({ balance: newBalance })
        .where({ id: wallet.id });

      await Transaction.query(trx)
        .patch({
          status: 'completed',
          balance_after: newBalance,
        })
        .where({ id: freshTxn.id });

      let invoice: any = null;
      if (freshTxn.type === 'deposit') {
        invoice = await invoiceService.generateForDeposit(trx, {
          userId: wallet.user_id,
          transactionId: freshTxn.id,
          amount: depositAmount,
        });
      }

      return {
        newBalance,
        invoice: invoice
          ? {
              id: invoice.id,
              invoice_number: invoice.invoice_number,
              amount: Number(invoice.amount),
              excise_duty: Number(invoice.excise_duty),
              net_amount: Number(invoice.net_amount),
            }
          : null,
      };
    });
  }

  async getDepositStatus(reference: string, userId: string) {
    let txn = await Transaction.query()
      .findOne({ reference })
      .withGraphJoined('wallet');

    // Fallback: Lipila may track by their internal identifier rather than our reference.
    if (!txn) {
      txn = await Transaction.query()
        .whereRaw("metadata->>'lipila_identifier' = ?", [reference])
        .withGraphJoined('wallet')
        .first();
    }

    if (!txn) {
      throw new Error('Transaction not found');
    }

    // Already completed — idempotent return
    if (txn.status === 'completed') {
      console.log(`[WalletDepositStatus] Transaction already completed — txnId=${txn.id}`);
      const freshWallet = await Wallet.query().findOne({ user_id: userId });
      return {
        status: 'completed' as const,
        balance: Number(freshWallet?.balance ?? 0),
        invoice: null,
      };
    }

    if (txn.status === 'failed' || txn.status === 'cancelled') {
      return { status: txn.status as 'failed' | 'cancelled' };
    }

    // Check with Lipila (by our reference first, then by their identifier if stored)
    const lipilaRef = reference;
    console.log(`[WalletDepositStatus] Checking Lipila status — reference=${lipilaRef}, currentTxnStatus=${txn.status}`);
    let lipilaStatus = await lipilaService.checkStatus(lipilaRef);
    console.log(`[WalletDepositStatus] Lipila responded — status=${lipilaStatus.status}, message=${lipilaStatus.message}, http=${lipilaStatus.httpStatus}`);

    // If our reference returned 404, try Lipila's internal identifier
    if (lipilaStatus.httpStatus === 404 && txn.metadata?.lipila_identifier) {
      const altRef = txn.metadata.lipila_identifier;
      console.log(`[WalletDepositStatus] Trying lipila_identifier instead — ${altRef}`);
      lipilaStatus = await lipilaService.checkStatus(altRef);
      console.log(`[WalletDepositStatus] Alt check responded — status=${lipilaStatus.status}, message=${lipilaStatus.message}, http=${lipilaStatus.httpStatus}`);
    }

    if (lipilaStatus.status === 'completed') {
      console.log(`[WalletDepositStatus] Completing deposit — crediting wallet for userId=${userId}, amount=${txn.amount}`);
      const result = await this.completeDepositTransaction(txn);
      console.log(`[WalletDepositStatus] Deposit completed — newBalance=${result.newBalance}, invoice=${result.invoice?.invoice_number || 'none'}`);
      return {
        status: 'completed' as const,
        balance: result.newBalance,
        invoice: result.invoice,
      };
    }

    if (lipilaStatus.status === 'failed') {
      console.log(`[WalletDepositStatus] Deposit failed — marking txn failed, reference=${reference}`);
      await Transaction.query()
        .patch({ status: 'failed' })
        .where({ id: txn.id });

      return {
        status: 'failed' as const,
        message: lipilaStatus.message,
      };
    }

    console.log(`[WalletDepositStatus] Still pending — reference=${reference}`);
    return {
      status: 'pending' as const,
      message: lipilaStatus.message,
    };
  }

  /**
   * Manually complete a pending deposit (used by admin or "I've paid" user button).
   */
  async forceCompleteDeposit(reference: string, userId: string) {
    const txn = await Transaction.query()
      .findOne({ reference })
      .withGraphJoined('wallet');

    if (!txn) {
      throw new Error('Transaction not found');
    }

    if (txn.status === 'completed') {
      const freshWallet = await Wallet.query().findOne({ user_id: userId });
      return {
        status: 'completed' as const,
        balance: Number(freshWallet?.balance ?? 0),
        message: 'Deposit was already completed',
      };
    }

    if (txn.status === 'failed' || txn.status === 'cancelled') {
      throw new Error(`Cannot complete a ${txn.status} transaction`);
    }

    const result = await this.completeDepositTransaction(txn);
    return {
      status: 'completed' as const,
      balance: result.newBalance,
      invoice: result.invoice,
      message: 'Deposit completed manually',
    };
  }

  // OPTIONAL: Payment gateway integration helper methods
  // Uncomment and implement when ready to integrate real payment processors

  /*
  private async processPaymentGateway(
    method: string,
    amount: number,
    details: any
  ): Promise<{ success: boolean; transactionRef?: string }> {
    switch (method) {
      case 'airtel':
        // Example: Airtel Money integration
        // const airtelResponse = await fetch('https://airtel-money-api.com/payment', {
        //   method: 'POST',
        //   headers: { 'Authorization': `Bearer ${process.env.AIRTEL_API_KEY}` },
        //   body: JSON.stringify({ amount, phone: details.mobileNumber })
        // });
        // return await airtelResponse.json();
        break;

      case 'mtn':
        // MTN Mobile Money API integration
        break;

      case 'zamtel':
        // Zamtel Money API integration
        break;

      case 'visa':
        // Card payment gateway (Stripe, Flutterwave, Paystack, etc.)
        break;

      case 'googlepay':
        // Google Pay API integration
        break;
    }

    // For now, simulate success
    return { success: true, transactionRef: uuidv4() };
  }

  private async processWithdrawalGateway(
    method: string,
    amount: number,
    details: any
  ): Promise<{ success: boolean; transactionRef?: string }> {
    // Similar to processPaymentGateway but for withdrawals
    return { success: true, transactionRef: uuidv4() };
  }
  */

  /**
   * Liability cap: how much more can this player win before their
   * cumulative winnings exceed their cumulative deposits?
   *
   * Returns the remaining win capacity (0 or positive). If the
   * player has already won more than they deposited, capacity is 0.
   *
   * Used by game services to force a "lose" outcome when a random
   * win would push the player past what the house has taken in.
   */
  async getWinCapacity(userId: string): Promise<number> {
    const wallet = await Wallet.query().findOne({ user_id: userId });
    if (!wallet) return 0;

    const knex = Wallet.knex();
    const depositRes = await knex.raw(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM transactions
      WHERE wallet_id = ? AND type = 'deposit' AND status = 'completed'
    `, [wallet.id]);
    const totalDeposits = Number(depositRes.rows[0].total);

    const winRes = await knex.raw(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM transactions
      WHERE wallet_id = ? AND type = 'win' AND status = 'completed'
    `, [wallet.id]);
    const totalWins = Number(winRes.rows[0].total);

    const capacity = totalDeposits - totalWins;
    console.log(`[WinCap] user=${userId} deposits=${totalDeposits} wins=${totalWins} capacity=${capacity}`);
    return Math.max(0, capacity);
  }
}