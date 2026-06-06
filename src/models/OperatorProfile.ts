import { Model, ModelObject } from 'objection';

// ============================================================================
// OperatorProfile model
//
// Singleton (id = 1). The company name and TPIN are printed on every
// PDF (invoice + tax return), so the renderer reads this row on every
// request. Updating it via PATCH /api/admin/tax/operator-profile takes
// effect on the next PDF render — no cache to invalidate.
// ============================================================================

export class OperatorProfile extends Model {
  static tableName = 'operator_profile';

  id!: number;
  company_name!: string;
  tpin!: string;
  address!: string | null;
  phone!: string | null;
  updated_at!: Date;
}

export type OperatorProfileType = ModelObject<OperatorProfile>;
