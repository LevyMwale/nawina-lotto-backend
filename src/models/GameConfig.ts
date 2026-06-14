import { Model, ModelObject } from 'objection';

export class GameConfig extends Model {
  static tableName = 'game_configs';

  id!: string;
  game_type!: string;
  odds_config!: any;
  payout_config!: any;
  economy_config?: any;
  display_config?: any;
  description?: string;
  rules_text?: string;
  min_stake!: number;
  max_stake!: number;
  is_active!: boolean;
  sort_order?: number;
  updated_at!: Date;
}

export type GameConfigType = ModelObject<GameConfig>;