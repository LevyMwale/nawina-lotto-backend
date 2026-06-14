import { Model, ModelObject } from 'objection';

export class Marketer extends Model {
  static tableName = 'marketers';

  id!: string;
  code!: string;
  phone!: string;
  pin_hash!: string;
  full_name?: string;
  status!: 'active' | 'suspended';
  commission_rate!: number;
  total_signups!: number;
  total_deposits!: number;
  total_wagering!: number;
  created_by_admin?: string;
  created_at!: Date;
  updated_at!: Date;
}

export type MarketerType = ModelObject<Marketer>;
