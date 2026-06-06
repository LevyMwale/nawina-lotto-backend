import { Model, ModelObject } from 'objection';
import { Wallet } from './Wallet';

export class Transaction extends Model {
  static tableName = 'transactions';

  id!: string;
  wallet_id!: string;
  type!: 'deposit' | 'withdrawal' | 'purchase' | 'win' | 'refund' | 'bet' | 'bonus';
  amount!: number;
  balance_before!: number;
  balance_after!: number;
  status!: 'pending' | 'completed' | 'failed' | 'cancelled';
  reference?: string;
  description?: string;
  metadata?: any;
  approved_by?: string;
  created_at!: Date;

  wallet?: Wallet;
  invoice?: import('./Invoice').Invoice;

  static relationMappings = {
    wallet: {
      relation: Model.BelongsToOneRelation,
      // Lazy class reference. Transaction doesn't share a cycle with
      // Wallet today, but using the function form here too keeps the
      // model-resolution pattern consistent across the codebase and
      // safe if a future relation is added.
      modelClass: () => require('./Wallet').Wallet,
      join: {
        from: 'transactions.wallet_id',
        to: 'wallets.id',
      },
    },
    invoice: {
      relation: Model.HasOneRelation,
      modelClass: () => require('./Invoice').Invoice,
      join: {
        from: 'transactions.id',
        to: 'invoices.transaction_id',
      },
    },
  };
}

export type TransactionType = ModelObject<Transaction>;