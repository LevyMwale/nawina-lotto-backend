"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('wallets', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.decimal('balance', 15, 2).notNullable().defaultTo(0).checkPositive();
        table.string('currency', 3).defaultTo('ZMW');
        table.decimal('locked_amount', 15, 2).defaultTo(0);
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        // Unique wallet per user
        table.unique('user_id');
        table.index('user_id');
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('wallets');
}
//# sourceMappingURL=002_create_wallets.js.map