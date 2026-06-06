import { Model, ModelObject } from 'objection';
import { User } from './User';

export class Wallet extends Model {
  static tableName = 'wallets';

  id!: string;
  user_id!: string;
  balance!: number;
  locked_amount!: number;  // Add this field
  currency!: string;
  created_at!: Date;
  updated_at!: Date;

  user?: User;

  static relationMappings = {
    user: {
      relation: Model.BelongsToOneRelation,
      // Direct import rather than the string 'User' for the same reason
      // as Transaction → Wallet: the string form can fail to resolve at
      // boot and surface as a 500 on /admin/transactions.
      modelClass: User,
      join: {
        from: 'wallets.user_id',
        to: 'users.id',
      },
    },
  };
}

export type WalletType = ModelObject<Wallet>;