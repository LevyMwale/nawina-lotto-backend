import { Model, ModelObject } from 'objection';

export class PromotionSetting extends Model {
  static tableName = 'promotion_settings';

  id!: string;
  key!: string;
  value!: any;
  updated_at!: Date;
}

export type PromotionSettingType = ModelObject<PromotionSetting>;
