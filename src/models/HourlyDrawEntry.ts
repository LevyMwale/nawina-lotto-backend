import { Model, ModelObject } from 'objection';

export class HourlyDrawEntry extends Model {
  static tableName = 'hourly_draw_entries';

  id!: string;
  draw_id!: string;
  user_id!: string;
  ticket_number!: number;
  amount_paid!: number;
  created_at!: Date;
}

export type HourlyDrawEntryType = ModelObject<HourlyDrawEntry>;
