import { Wallet } from '../models/Wallet';
import { Transaction } from '../models/Transaction';
import { transaction } from 'objection';
import { v4 as uuidv4 } from 'uuid';
import { InvoiceService } from './invoice.service';

// Single shared instance — InvoiceService is stateless and we want
// the same in-flight request to use one allocation path.
const invoiceService = new InvoiceService();

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

  async deduct(userId: string, amount: number, type: 'bet' | 'purchase', metadata?: any) {
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    return await transaction(Wallet.knex(), async (trx) => {
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
    });
  }

  async credit(userId: string, amount: number, type: 'win' | 'deposit' | 'refund' | 'bonus', metadata?: any) {
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    return await transaction(Wallet.knex(), async (trx) => {
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
    });
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
}