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
      // Lazy class reference to break the User ↔ Wallet cycle. Objection
      // invokes the function when the relation is first built, by which
      // point both modules have finished evaluating. A direct import
      // would be `undefined` here because User.ts is in the middle of
      // loading and hasn't reached its `export class User` yet.
      modelClass: () => require('./User').User,
      join: {
        from: 'wallets.user_id',
        to: 'users.id',
      },
    },
  };
}

export type WalletType = ModelObject<Wallet>;