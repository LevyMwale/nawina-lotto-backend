import { Model, ModelObject } from 'objection';

// ============================================================================
// ZraReturn model
//
// Snapshot of a tax return for a given period. The headline totals and
// the per-player breakdown are stored at generation time, so re-rendering
// the PDF later (or a ZRA audit) sees the same numbers that were filed,
// not a recomputation that drifts as new transactions arrive.
// ============================================================================

export interface PlayerTaxLine {
  user_id: string;
  phone: string;
  full_name: string | null;
  deposits: number;
  payouts: number;
  presumptive: number;
  withholding: number;
  excise: number;
}

export class ZraReturn extends Model {
  static tableName = 'zra_returns';

  id!: string;
  period_start!: string;       // date as YYYY-MM-DD
  period_end!: string;         // date as YYYY-MM-DD (inclusive)
  total_deposits!: number;
  total_payouts!: number;
  net_revenue!: number;
  presumptive_tax!: number;
  withholding_tax!: number;
  excise_duty!: number;
  total_tax!: number;
  player_breakdown!: PlayerTaxLine[];
  status!: 'draft' | 'filed';
  filed_at!: Date | null;
  filed_by!: string | null;
  created_at!: Date;
}

export type ZraReturnType = ModelObject<ZraReturn>;
