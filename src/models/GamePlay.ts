import { Model, ModelObject } from 'objection';

export class GamePlay extends Model {
  static tableName = 'game_plays';

  id!: string;
  user_id!: string;
  game_type!: string;
  stake!: number;
  bet_data?: any;
  result!: any;
  payout!: number;
  rng_seed!: string;
  house_edge?: number;
  created_at!: Date;
}

export type GamePlayType = ModelObject<GamePlay>;