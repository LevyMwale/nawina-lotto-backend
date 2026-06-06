import { Knex } from 'knex';

// ============================================================================
// Migration 007 — ZRA tax returns, auto-invoices, operator profile
//
// Three tables and two sequences:
//
//   1. invoices       — one per successful deposit. Auto-generated inside
//                       the same DB transaction as the deposit credit so
//                       an invoice can never be missing for a completed
//                       deposit. Invoice numbers use a per-year sequence
//                       so a year-end reset is a no-op for parsers.
//
//   2. zra_returns    — snapshot of a tax return for a given period. The
//                       full per-player breakdown is stored in JSONB so
//                       the same return can be re-downloaded as a PDF
//                       later, and a "filed" version is locked from
//                       re-generation by overwriting its own row.
//
//   3. operator_profile — singleton row (id = 1) with the operator's
//                       company name, TPIN, address, and phone. Read on
//                       every PDF render. Created here with defaults so
//                       the first PDF works before anyone fills it in.
//
// Idempotency: every step is gated on a hasTable / hasColumn check, so
// the migration is safe to re-run on a partially-applied database.
// ============================================================================

export async function up(knex: Knex): Promise<void> {
  // --------------------------------------------------------------------------
  // 1. Per-year invoice number sequence. We use one shared sequence and
  //    stamp the year into the formatted invoice number, so we don't
  //    need a new sequence every January. The number itself is the
  //    stable, monotonic id — the year prefix is just for human reading.
  // --------------------------------------------------------------------------
  const seqExists = await knex.raw(`
    SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'invoice_number_seq') AS e;
  `);
  if (!seqExists.rows[0].e) {
    await knex.raw(`CREATE SEQUENCE invoice_number_seq START WITH 1 INCREMENT BY 1;`);
  }

  // --------------------------------------------------------------------------
  // 2. Invoices table
  // --------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('invoices'))) {
    await knex.schema.createTable('invoices', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.uuid('transaction_id').notNullable().references('id').inTable('transactions').onDelete('CASCADE');
      table.string('invoice_number', 30).notNullable().unique();
      // numeric(12,2) — up to 9,999,999,999.99. K-watches won't get that
      // big anytime soon; if they do, bump it.
      table.decimal('amount', 12, 2).notNullable();
      table.decimal('excise_duty', 12, 2).notNullable();
      table.decimal('net_amount', 12, 2).notNullable();
      table.string('currency', 3).notNullable().defaultTo('ZMW');
      table.timestamp('issue_date').notNullable().defaultTo(knex.fn.now());
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
    await knex.schema.alterTable('invoices', (table) => {
      table.index(['user_id'], 'invoices_user_id_idx');
      table.index(['issue_date'], 'invoices_issue_date_idx');
    });
  }

  // --------------------------------------------------------------------------
  // 3. ZRA tax returns table
  // --------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('zra_returns'))) {
    await knex.schema.createTable('zra_returns', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.date('period_start').notNullable();
      table.date('period_end').notNullable();
      // Headline totals. Stored as numeric so the PDF and any future
      // CSV export format to 2dp without a JS roundtrip.
      table.decimal('total_deposits', 14, 2).notNullable();
      table.decimal('total_payouts', 14, 2).notNullable();
      table.decimal('net_revenue', 14, 2).notNullable();
      table.decimal('presumptive_tax', 14, 2).notNullable();
      table.decimal('withholding_tax', 14, 2).notNullable();
      table.decimal('excise_duty', 14, 2).notNullable();
      table.decimal('total_tax', 14, 2).notNullable();
      // Per-player breakdown as JSONB. Schema:
      //   [{ user_id, phone, full_name, deposits, payouts,
      //      presumptive, withholding, excise }, ...]
      // We store the breakdown frozen at generation time so re-running
      // the same query later (after more transactions have completed)
      // doesn't change the numbers on a filed return.
      table.jsonb('player_breakdown').notNullable();
      table.string('status', 20).notNullable().defaultTo('draft');
      table.timestamp('filed_at').nullable();
      table.uuid('filed_by').nullable().references('id').inTable('admins').onDelete('SET NULL');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
    await knex.schema.alterTable('zra_returns', (table) => {
      table.index(['period_start', 'period_end'], 'zra_returns_period_idx');
    });
    await knex.raw(`
      ALTER TABLE zra_returns
      ADD CONSTRAINT zra_returns_status_check
      CHECK (status IN ('draft', 'filed'));
    `);
  }

  // --------------------------------------------------------------------------
  // 4. Operator profile (singleton). id = 1 is the only row; any future
  //    "switch company" feature would add a row and re-point a config key.
  // --------------------------------------------------------------------------
  if (!(await knex.schema.hasTable('operator_profile'))) {
    await knex.schema.createTable('operator_profile', (table) => {
      table.integer('id').primary(); // always 1
      table.string('company_name', 200).notNullable().defaultTo('NaWiNa Lotto');
      table.string('tpin', 20).notNullable().defaultTo('1000000000');
      table.text('address').nullable();
      table.string('phone', 30).nullable();
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });

    await knex('operator_profile').insert({
      id: 1,
      company_name: 'NaWiNa Lotto',
      tpin: '1000000000',
    }).onConflict(['id']).ignore();
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('zra_returns');
  await knex.schema.dropTableIfExists('invoices');
  await knex.schema.dropTableIfExists('operator_profile');
  await knex.raw(`DROP SEQUENCE IF EXISTS invoice_number_seq;`);
}
