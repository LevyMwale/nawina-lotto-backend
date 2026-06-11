import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. Add 'bonus' to transactions.type CHECK constraint
  //    The original migration created this as a CHECK constraint on a text
  //    column (Knex's table.enum() on Postgres creates varchar + CHECK, not
  //    a real Postgres enum type). We need to drop and recreate it.
  const hasTypeCheck = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'transactions_type_check'
    ) AS exists;
  `);

  if (hasTypeCheck.rows[0].exists) {
    await knex.raw(`ALTER TABLE transactions DROP CONSTRAINT transactions_type_check;`);
  }

  await knex.raw(`
    ALTER TABLE transactions
    ADD CONSTRAINT transactions_type_check
    CHECK (type IN ('deposit', 'withdrawal', 'bet', 'win', 'refund', 'bonus'));
  `);

  // 2. Add status column to users (active/suspended/banned)
  //    is_active boolean already exists; status gives more granularity.
  const hasStatus = await knex.schema.hasColumn('users', 'status');
  if (!hasStatus) {
    await knex.schema.alterTable('users', (table) => {
      table.string('status', 20).defaultTo('active');
    });

    // Backfill status from is_active for existing rows
    await knex.raw(`
      UPDATE users SET status = CASE
        WHEN is_active = true THEN 'active'
        ELSE 'suspended'
      END;
    `);

    await knex.raw(`
      ALTER TABLE users
      ADD CONSTRAINT users_status_check
      CHECK (status IN ('active', 'suspended', 'banned'));
    `);
  }

  // 3. Create admins table
  const hasAdmins = await knex.schema.hasTable('admins');
  if (!hasAdmins) {
    await knex.schema.createTable('admins', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('username', 50).notNullable().unique();
      table.string('password_hash', 255).notNullable();
      table.string('role', 20).defaultTo('admin');
      table.string('full_name', 100);
      table.timestamp('last_login').nullable();
      table.boolean('is_active').defaultTo(true);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.index('username');
    });

    await knex.raw(`
      ALTER TABLE admins
      ADD CONSTRAINT admins_role_check
      CHECK (role IN ('super_admin', 'admin', 'moderator'));
    `);

    // Seed default super admin: username 'admin', password 'admin123'
    // Hash is bcrypt of 'admin123' with cost 12
    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash('admin123', 12);

    await knex('admins').insert({
      username: 'admin',
      password_hash: passwordHash,
      role: 'super_admin',
      full_name: 'System Administrator',
      is_active: true,
    });
  }

  // 4. Add admin reference column on transactions for audit trail
  const hasApprovedBy = await knex.schema.hasColumn('transactions', 'approved_by');
  if (!hasApprovedBy) {
    await knex.schema.alterTable('transactions', (table) => {
      table.uuid('approved_by').nullable().references('id').inTable('admins').onDelete('SET NULL');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Remove admin reference from transactions
  const hasApprovedBy = await knex.schema.hasColumn('transactions', 'approved_by');
  if (hasApprovedBy) {
    await knex.schema.alterTable('transactions', (table) => {
      table.dropColumn('approved_by');
    });
  }

  // Drop admins table
  await knex.schema.dropTableIfExists('admins');

  // Remove status column
  const hasStatus = await knex.schema.hasColumn('users', 'status');
  if (hasStatus) {
    await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;`);
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('status');
    });
  }

  // Restore original transactions.type check
  await knex.raw(`
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
  `);
  await knex.raw(`
    ALTER TABLE transactions
    ADD CONSTRAINT transactions_type_check
    CHECK (type IN ('deposit', 'withdrawal', 'bet', 'win', 'refund'));
  `);
}
