import { Model, ModelObject } from 'objection';
import { User } from './User';
import { Transaction } from './Transaction';

// ============================================================================
// Invoice model
//
// One row per invoice. Generated automatically by InvoiceService when
// a deposit credit completes. The actual download URL is computed at
// request time (GET /api/invoices/:id/pdf) — we don't store the PDF
// binary, just the rows that re-derive it.
// ============================================================================

export class Invoice extends Model {
  static tableName = 'invoices';

  id!: string;
  user_id!: string;
  transaction_id!: string;
  invoice_number!: string;
  amount!: number;
  excise_duty!: number;
  net_amount!: number;
  currency!: string;
  issue_date!: Date;
  created_at!: Date;

  // Optional eager-loaded relations for the PDF renderer.
  user?: User;

  static relationMappings = {
    user: {
      relation: Model.BelongsToOneRelation,
      modelClass: () => require('./User').User,
      join: {
        from: 'invoices.user_id',
        to: 'users.id',
      },
    },
    transaction: {
      relation: Model.BelongsToOneRelation,
      modelClass: () => require('./Transaction').Transaction,
      join: {
        from: 'invoices.transaction_id',
        to: 'transactions.id',
      },
    },
  };
}

export type InvoiceType = ModelObject<Invoice>;
