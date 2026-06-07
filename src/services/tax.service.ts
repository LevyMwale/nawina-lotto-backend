import { Knex } from 'knex';
import { ZraReturn, PlayerTaxLine } from '../models/ZraReturn';
import { OperatorProfile } from '../models/OperatorProfile';

// ============================================================================
// Tax service — ZRA gaming tax returns
//
// Three taxes per the Zambia Revenue Authority gaming-tax framework:
//
//   Presumptive tax  = 15% × (deposits − payouts)   // "what we make"
//   Withholding tax  = 15% × total payouts          // "what players won"
//   Excise duty      =  5% × total deposits         // "on every deposit"
//
// Algebra:
//   0.15(D − P) + 0.15P + 0.05D = 0.20D
// so the three line items sum to exactly 20% of total deposits, which
// matches the operator's mental model. We report each line separately
// because ZRA audits per-head — a per-player breakdown is required.
//
// Only `status = 'completed'` transactions count. Pending withdrawals
// and failed deposits are not yet taxable.
// ============================================================================

const RATES = {
  presumptive: 0.15,
  withholding: 0.15,
  excise: 0.05,
};

export interface ComputedReturn {
  periodStart: string;       // YYYY-MM-DD inclusive
  periodEnd: string;         // YYYY-MM-DD inclusive
  totalDeposits: number;
  totalPayouts: number;
  netRevenue: number;
  presumptiveTax: number;
  withholdingTax: number;
  exciseDuty: number;
  totalTax: number;
  playerBreakdown: PlayerTaxLine[];
}

export class TaxService {
  // -------------------------------------------------------------------------
  // computeReturn — read-only, doesn't persist. Used by the admin screen
  // for a live preview before the operator hits "Generate".
  // -------------------------------------------------------------------------
  async computeReturn(periodStart: string, periodEnd: string): Promise<ComputedReturn> {
    assertValidPeriod(periodStart, periodEnd);

    // Inclusive end → exclusive end for the SQL range.
    const rangeStart = periodStart;
    const rangeEnd = addDays(periodEnd, 1);

    // Single aggregation query. The `CASE` filters do double duty:
    // they let us keep one scan and one join, and they ignore any
    // transaction type that isn't a deposit or a win (e.g. bets are
    // internal transfers, not revenue to the player).
    const sql = `
      SELECT u.id            AS user_id,
             u.phone         AS phone,
             u.full_name     AS full_name,
             COALESCE(SUM(CASE WHEN t.type = 'deposit' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS deposits,
             COALESCE(SUM(CASE WHEN t.type = 'win'     AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS payouts
      FROM users u
      LEFT JOIN wallets w       ON w.user_id = u.id
      LEFT JOIN transactions t  ON t.wallet_id = w.id
                                AND t.created_at >= ? AND t.created_at < ?
      GROUP BY u.id, u.phone, u.full_name
      HAVING COALESCE(SUM(CASE WHEN t.type = 'deposit' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) > 0
          OR COALESCE(SUM(CASE WHEN t.type = 'win'     AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) > 0
      ORDER BY (COALESCE(SUM(CASE WHEN t.type = 'deposit' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0)
              + COALESCE(SUM(CASE WHEN t.type = 'win'     AND t.status = 'completed' THEN t.amount ELSE 0 END), 0)) DESC;
    `;
    const knex = ZraReturn.knex();
    const rows: any[] = await knex.raw(sql, [rangeStart, rangeEnd]).then((r: any) => r.rows ?? r);

    // One-line log so the operator can see in the Render logs what
    // date range the query actually used. Useful for debugging
    // "K0.00 in the UI but I have transactions" reports.
    console.log(
      `[tax] computeReturn ${periodStart}..${periodEnd} ` +
      `(sql: ${rangeStart}..<${rangeEnd}): ${rows.length} player row(s)`,
    );

    const breakdown: PlayerTaxLine[] = rows.map((r) => {
      const deposits = round2(Number(r.deposits) || 0);
      const payouts = round2(Number(r.payouts) || 0);
      const net = round2(deposits - payouts);
      return {
        user_id: r.user_id,
        phone: r.phone || '',
        full_name: r.full_name || null,
        deposits,
        payouts,
        presumptive: round2(Math.max(net, 0) * RATES.presumptive),
        withholding: round2(payouts * RATES.withholding),
        excise: round2(deposits * RATES.excise),
      };
    });

    const totalDeposits = round2(breakdown.reduce((s, b) => s + b.deposits, 0));
    const totalPayouts = round2(breakdown.reduce((s, b) => s + b.payouts, 0));
    const presumptiveTax = round2(breakdown.reduce((s, b) => s + b.presumptive, 0));
    const withholdingTax = round2(breakdown.reduce((s, b) => s + b.withholding, 0));
    const exciseDuty = round2(breakdown.reduce((s, b) => s + b.excise, 0));

    return {
      periodStart,
      periodEnd,
      totalDeposits,
      totalPayouts,
      netRevenue: round2(totalDeposits - totalPayouts),
      presumptiveTax,
      withholdingTax,
      exciseDuty,
      totalTax: round2(presumptiveTax + withholdingTax + exciseDuty),
      playerBreakdown: breakdown,
    };
  }

  // -------------------------------------------------------------------------
  // generateReturn — persist a draft snapshot. Re-running for the same
  // period creates a new row (history preserved), unless there's already
  // a draft, which is replaced so the operator doesn't pile up identical
  // rows while tweaking inputs.
  // -------------------------------------------------------------------------
  async generateReturn(periodStart: string, periodEnd: string): Promise<ZraReturn> {
    const computed = await this.computeReturn(periodStart, periodEnd);

    const knex = ZraReturn.knex();
    return knex.transaction(async (trx: Knex.Transaction) => {
      // Replace any existing draft for the same period. Filed returns
      // are preserved.
      await trx<ZraReturn>('zra_returns')
        .where({ period_start: periodStart, period_end: periodEnd, status: 'draft' })
        .del();

      const inserted = await ZraReturn.query(trx).insert({
        period_start: periodStart,
        period_end: periodEnd,
        total_deposits: computed.totalDeposits,
        total_payouts: computed.totalPayouts,
        net_revenue: computed.netRevenue,
        presumptive_tax: computed.presumptiveTax,
        withholding_tax: computed.withholdingTax,
        excise_duty: computed.exciseDuty,
        total_tax: computed.totalTax,
        // JSONB column — stringify for the insert. The `any` cast is
        // a deliberate escape hatch from Objection's strict
        // PlayerTaxLine[] typing, which makes TS think the literal is
        // something more specific than JSON.parse wants to see.
        player_breakdown: JSON.stringify(computed.playerBreakdown) as any,
        status: 'draft',
      });
      return inserted!;
    });
  }

  async getReturn(id: string): Promise<ZraReturn | null> {
    return (await ZraReturn.query().findById(id)) ?? null;
  }

  async listReturns(): Promise<ZraReturn[]> {
    return ZraReturn.query()
      .orderBy('created_at', 'desc')
      .limit(200);
  }

  // -------------------------------------------------------------------------
  // markFiled — lock the return. After this, the numbers can't be changed
  // by re-running computeReturn. The PDF keeps rendering the same row.
  // -------------------------------------------------------------------------
  async markFiled(id: string, adminId: string): Promise<ZraReturn> {
    const existing = await ZraReturn.query().findById(id);
    if (!existing) throw new Error('ZRA return not found');
    if (existing.status === 'filed') {
      throw new Error('This return is already marked as filed');
    }
    await ZraReturn.query()
      .patch({ status: 'filed', filed_at: new Date(), filed_by: adminId })
      .where({ id });
    return (await ZraReturn.query().findById(id))!;
  }

  // -------------------------------------------------------------------------
  // Operator profile — singleton. PDF templates read this on every render.
  // -------------------------------------------------------------------------
  async getOperatorProfile(): Promise<OperatorProfile> {
    let p = await OperatorProfile.query().findById(1);
    if (!p) {
      // Defensive seed: migration 007 inserts the row, but if someone
      // wipes the DB we still want a usable default rather than a 500.
      await OperatorProfile.query().insert({ id: 1 });
      p = (await OperatorProfile.query().findById(1))!;
    }
    return p;
  }

  async updateOperatorProfile(patch: {
    company_name?: string;
    tpin?: string;
    address?: string | null;
    phone?: string | null;
  }): Promise<OperatorProfile> {
    await this.getOperatorProfile(); // ensure the row exists
    await OperatorProfile.query()
      .patch({ ...patch, updated_at: new Date() })
      .where({ id: 1 });
    return (await OperatorProfile.query().findById(1))!;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addDays(yyyymmdd: string, days: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function assertValidPeriod(start: string, end: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error('periodStart must be YYYY-MM-DD');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end))   throw new Error('periodEnd must be YYYY-MM-DD');
  if (start > end) throw new Error('periodStart must be on or before periodEnd');
}
