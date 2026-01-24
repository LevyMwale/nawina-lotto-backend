"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const objection_1 = require("objection");
const Wallet_1 = require("./Wallet");
class User extends objection_1.Model {
}
exports.User = User;
User.tableName = 'users';
User.relationMappings = {
    wallet: {
        relation: objection_1.Model.HasOneRelation,
        modelClass: Wallet_1.Wallet,
        join: {
            from: 'users.id',
            to: 'wallets.user_id',
        },
    },
};
//# sourceMappingURL=User.js.map