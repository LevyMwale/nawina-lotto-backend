"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('game_configs', (table) => {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.string('game_type', 50).notNullable().unique();
        table.jsonb('odds_config').notNullable();
        table.jsonb('payout_config').notNullable();
        table.decimal('min_stake', 10, 2);
        table.decimal('max_stake', 10, 2);
        table.boolean('is_active').defaultTo(true);
        table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('game_configs');
}
//# sourceMappingURL=005_create_game_configs.js.map