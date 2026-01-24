"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transaction = void 0;
const objection_1 = require("objection");
class Transaction extends objection_1.Model {
}
exports.Transaction = Transaction;
Transaction.tableName = 'transactions';
Transaction.relationMappings = {
    wallet: {
        relation: objection_1.Model.BelongsToOneRelation,
        modelClass: 'Wallet',
        join: {
            from: 'transactions.wallet_id',
            to: 'wallets.id',
        },
    },
};
//# sourceMappingURL=Transaction.js.map