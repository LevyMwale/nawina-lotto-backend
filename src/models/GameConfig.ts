import { Model, ModelObject } from 'objection';

export class GameConfig extends Model {
  static tableName = 'game_configs';

  id!: string;
  game_type!: string;
  odds_config!: any;
  payout_config!: any;
  min_stake!: number;
  max_stake!: number;
  is_active!: boolean;
  updated_at!: Date;
}

export type GameConfigType = ModelObject<GameConfig>;