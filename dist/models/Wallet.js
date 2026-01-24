"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Wallet = void 0;
const objection_1 = require("objection");
class Wallet extends objection_1.Model {
}
exports.Wallet = Wallet;
Wallet.tableName = 'wallets';
Wallet.relationMappings = {
    user: {
        relation: objection_1.Model.BelongsToOneRelation,
        modelClass: 'User',
        join: {
            from: 'wallets.user_id',
            to: 'users.id',
        },
    },
};
//# sourceMappingURL=Wallet.js.map