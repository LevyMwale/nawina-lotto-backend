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

  static relationMappings = {
    wallet: {
      relation: Model.BelongsToOneRelation,
      // Import the class directly rather than the string 'Wallet' — the
      // string form depends on Objection's `modelPaths` auto-discovery
      // and can fail at boot with
      // "Transaction.relationMappings.wallet: modelClass: could not
      //  resolve Wallet using modelPaths". Direct import is reliable.
      modelClass: Wallet,
      join: {
        from: 'transactions.wallet_id',
        to: 'wallets.id',
      },
    },
  };
}

export type TransactionType = ModelObject<Transaction>;