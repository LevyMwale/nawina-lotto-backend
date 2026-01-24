import dotenv from 'dotenv';
dotenv.config();

import Knex from 'knex';
import { knexConfig } from './src/config/database';

const knex = Knex(knexConfig);

async function fixWalletConstraint() {
  console.log('Fixing wallet balance constraint...\n');

  try {
    // Drop the existing constraint
    await knex.raw('ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_balance_check');
    console.log('Dropped old constraint');

    // Add new constraint that allows zero or positive balance
    await knex.raw('ALTER TABLE wallets ADD CONSTRAINT wallets_balance_check CHECK (balance >= 0)');
    console.log('Added new constraint: balance >= 0');

    // Also fix available balance if it exists
    await knex.raw('ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_available_check');
    await knex.raw('ALTER TABLE wallets ADD CONSTRAINT wallets_available_check CHECK (available >= 0)');
    console.log('Added constraint: available >= 0');

    console.log('\nWallet constraints fixed successfully!');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await knex.destroy();
  }
}

fixWalletConstraint();
