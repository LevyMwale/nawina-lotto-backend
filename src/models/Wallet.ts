import { Model, ModelObject } from 'objection';

export class Wallet extends Model {
  static tableName = 'wallets';

  id!: string;
  user_id!: string;
  balance!: number;
  locked_amount!: number;  // Add this field
  currency!: string;
  created_at!: Date;
  updated_at!: Date;

  static relationMappings = {
    user: {
      relation: Model.BelongsToOneRelation,
      modelClass: 'User',
      join: {
        from: 'wallets.user_id',
        to: 'users.id',
      },
    },
  };
}

export type WalletType = ModelObject<Wallet>;