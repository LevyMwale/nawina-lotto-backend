import { Model, ModelObject } from 'objection';
// Side-effect import is not needed — we resolve the class lazily below
// to break the User ↔ Wallet cycle. Wallet.ts is mid-evaluation when
// this file's static relationMappings fires, so a direct `import { Wallet }`
// would still be `undefined` at that point.

export class User extends Model {
  static tableName = 'users';

  id!: string;
  phone!: string;
  pin_hash!: string;
  full_name?: string;
  national_id?: string;
  kyc_status!: 'pending' | 'verified' | 'rejected';
  status?: 'active' | 'suspended' | 'banned';
  date_of_birth?: Date;
  is_active!: boolean;
  referred_by_marketer_id?: string;
  first_deposit_at?: Date;
  first_deposit_amount?: number;
  created_at!: Date;
  updated_at!: Date;

  wallet?: import('./Wallet').Wallet;
  marketer?: import('./Marketer').Marketer;

  static relationMappings = {
    wallet: {
      relation: Model.HasOneRelation,
      // Lazy resolution — see the comment at the top of the file.
      modelClass: () => require('./Wallet').Wallet,
      join: {
        from: 'users.id',
        to: 'wallets.user_id',
      },
    },
    marketer: {
      relation: Model.BelongsToOneRelation,
      modelClass: () => require('./Marketer').Marketer,
      join: {
        from: 'users.referred_by_marketer_id',
        to: 'marketers.id',
      },
    },
  };
}

export type UserType = ModelObject<User>;