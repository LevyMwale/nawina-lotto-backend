"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletService = void 0;
const Wallet_1 = require("../models/Wallet");
const Transaction_1 = require("../models/Transaction");
const objection_1 = require("objection");
const uuid_1 = require("uuid");
class WalletService {
    async getBalance(userId) {
        const wallet = await Wallet_1.Wallet.query().findOne({ user_id: userId });
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
    async deduct(userId, amount, type, metadata) {
        if (amount <= 0) {
            throw new Error('Amount must be positive');
        }
        return await (0, objection_1.transaction)(Wallet_1.Wallet.knex(), async (trx) => {
            const wallet = await Wallet_1.Wallet.query(trx)
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
            await Wallet_1.Wallet.query(trx)
                .patch({ balance: newBalance })
                .where({ id: wallet.id });
            const txn = await Transaction_1.Transaction.query(trx).insert({
                wallet_id: wallet.id,
                type,
                amount: -amount,
                balance_before: Number(wallet.balance),
                balance_after: newBalance,
                status: 'completed',
                reference: `${type.toUpperCase()}-${(0, uuid_1.v4)()}`,
                metadata,
            });
            return {
                transaction_id: txn.id,
                new_balance: newBalance,
            };
        });
    }
    async credit(userId, amount, type, metadata) {
        if (amount <= 0) {
            throw new Error('Amount must be positive');
        }
        return await (0, objection_1.transaction)(Wallet_1.Wallet.knex(), async (trx) => {
            const wallet = await Wallet_1.Wallet.query(trx)
                .findOne({ user_id: userId })
                .forUpdate();
            if (!wallet) {
                throw new Error('Wallet not found');
            }
            const newBalance = Number(wallet.balance) + amount;
            await Wallet_1.Wallet.query(trx)
                .patch({ balance: newBalance })
                .where({ id: wallet.id });
            const txn = await Transaction_1.Transaction.query(trx).insert({
                wallet_id: wallet.id,
                type,
                amount,
                balance_before: Number(wallet.balance),
                balance_after: newBalance,
                status: 'completed',
                reference: `${type.toUpperCase()}-${(0, uuid_1.v4)()}`,
                metadata,
            });
            return {
                transaction_id: txn.id,
                new_balance: newBalance,
            };
        });
    }
    // Deposit method
    async deposit(userId, amount, method, details) {
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
        // Use the existing credit method to add funds
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
        };
    }
    // Withdraw method
    async withdraw(userId, amount, method, details) {
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
    async getTransactions(userId, limit = 50, offset = 0) {
        const wallet = await Wallet_1.Wallet.query().findOne({ user_id: userId });
        if (!wallet) {
            throw new Error('Wallet not found');
        }
        const transactions = await Transaction_1.Transaction.query()
            .where({ wallet_id: wallet.id })
            .orderBy('created_at', 'desc')
            .limit(limit)
            .offset(offset);
        return transactions.map((txn) => ({
            id: txn.id,
            type: txn.type,
            amount: Number(txn.amount),
            status: txn.status,
            reference: txn.reference,
            created_at: txn.created_at,
        }));
    }
}
exports.WalletService = WalletService;
//# sourceMappingURL=wallet.service.js.map