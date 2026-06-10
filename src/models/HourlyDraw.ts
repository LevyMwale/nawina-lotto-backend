import { Model, ModelObject } from 'objection';

export class HourlyDraw extends Model {
  static tableName = 'hourly_draws';

  id!: string;
  scheduled_at!: Date;
  status!: 'open' | 'closed' | 'completed' | 'cancelled';
  ticket_price!: number;
  total_pool!: number;
  prize_pool!: number;
  house_edge_amount!: number;
  admin_prize_pool?: number;
  winner_user_id?: string;
  winning_ticket_number?: number;
  rng_seed?: string;
  completed_at?: Date;
  created_at!: Date;
}

export type HourlyDrawType = ModelObject<HourlyDraw>;
