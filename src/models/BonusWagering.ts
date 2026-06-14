import { Model, ModelObject } from 'objection';

export class BonusWagering extends Model {
  static tableName = 'bonus_wagering';

  id!: string;
  user_id!: string;
  bonus_transaction_id!: string;
  marketer_id?: string;
  amount!: number;
  wagering_required!: number;
  wagering_completed!: number;
  status!: 'active' | 'released' | 'expired' | 'forfeited';
  expires_at?: Date;
  released_at?: Date;
  created_at!: Date;
  updated_at!: Date;
}

export type BonusWageringType = ModelObject<BonusWagering>;
