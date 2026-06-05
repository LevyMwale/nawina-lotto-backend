import { Model, ModelObject } from 'objection';
import { Wallet } from './Wallet';

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
  created_at!: Date;
  updated_at!: Date;

  wallet?: Wallet;

  static relationMappings = {
    wallet: {
      relation: Model.HasOneRelation,
      modelClass: Wallet,
      join: {
        from: 'users.id',
        to: 'wallets.user_id',
      },
    },
  };
}

export type UserType = ModelObject<User>;