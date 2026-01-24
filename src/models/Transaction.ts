import { Model, ModelObject } from 'objection';

export class Transaction extends Model {
  static tableName = 'transactions';

  id!: string;
  wallet_id!: string;
  type!: 'deposit' | 'withdrawal' | 'purchase' | 'win' | 'refund' | 'bet';
  amount!: number;
  balance_before!: number;
  balance_after!: number;
  status!: 'pending' | 'completed' | 'failed' | 'cancelled';  // Add this
  reference?: string;
  description?: string;
  metadata?: any;
  created_at!: Date;

  static relationMappings = {
    wallet: {
      relation: Model.BelongsToOneRelation,
      modelClass: 'Wallet',
      join: {
        from: 'transactions.wallet_id',
        to: 'wallets.id',
      },
    },
  };
}

export type TransactionType = ModelObject<Transaction>;