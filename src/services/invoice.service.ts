import { Knex } from 'knex';
import { Invoice } from '../models/Invoice';

// ============================================================================
// Invoice service
//
// One invoice per successful deposit. Generated inside the same DB
// transaction as the deposit credit, so a deposit can never exist
// without its invoice. If the invoice insert fails, the deposit
// rolls back.
//
// Invoice number format: INV-{year}-{6-digit-seq}
//   e.g. INV-2026-000123
// The sequence is shared across years; the year is stamped from the
// issue_date for human readability. ZRA doesn't require a particular
// format, but the year prefix makes a paper trail easy to scan.
// ============================================================================

const EXCISE_RATE = 0.05; // 5% excise duty on every deposit

export class InvoiceService {
  /**
   * Generate the invoice for a deposit transaction. Must be called
   * inside the same Objection `transaction(trx, ...)` that created
   * the transaction row, so the invoice and the deposit are atomic.
   */
  async generateForDeposit(
    trx: Knex.Transaction,
    args: {
      userId: string;
      transactionId: string;
      amount: number;
    },
  ): Promise<Invoice> {
    // Round to 2dp — matches the numeric(12,2) column and avoids
    // drift between the stored amount and the on-PDF number.
    const amount = round2(args.amount);
    const exciseDuty = round2(amount * EXCISE_RATE);
    const netAmount = round2(amount - exciseDuty);
    const invoiceNumber = await this.nextInvoiceNumber(trx, new Date());

    const invoice = await Invoice.query(trx).insert({
      user_id: args.userId,
      transaction_id: args.transactionId,
      invoice_number: invoiceNumber,
      amount,
      excise_duty: exciseDuty,
      net_amount: netAmount,
      currency: 'ZMW',
    });
    return invoice;
  }

  /**
   * Read invoices for a single user, newest first. Bounded by `limit`
   * (default 50) so the wallet tab doesn't pull hundreds of rows.
   */
  async getForUser(userId: string, limit = 50): Promise<Invoice[]> {
    return Invoice.query()
      .where({ user_id: userId })
      .orderBy('issue_date', 'desc')
      .limit(limit);
  }

  async getById(id: string): Promise<Invoice | null> {
    return (await Invoice.query().findById(id)) ?? null;
  }

  /**
   * Allocate the next invoice number. We use a shared Postgres sequence
   * so the allocator is concurrency-safe even under load — two deposits
   * arriving at the same millisecond will get consecutive numbers, not
   * the same one. The year prefix is decorative; the sequence is the
   * real id.
   */
  private async nextInvoiceNumber(trx: Knex.Transaction, when: Date): Promise<string> {
    const r: any = await trx.raw(`SELECT nextval('invoice_number_seq') AS n;`);
    const n = Number(r.rows?.[0]?.n ?? r?.[0]?.n ?? 0);
    const year = when.getUTCFullYear();
    return `INV-${year}-${String(n).padStart(6, '0')}`;
  }
}

function round2(n: number): number {
  // Banker's rounding isn't required for tax — straight half-up is
  // what every other part of the system does (see wallet.service).
  return Math.round(n * 100) / 100;
}
