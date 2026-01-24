import { Model, ModelObject } from 'objection';
export declare class Wallet extends Model {
    static tableName: string;
    id: string;
    user_id: string;
    balance: number;
    locked_amount: number;
    currency: string;
    created_at: Date;
    updated_at: Date;
    static relationMappings: {
        user: {
            relation: import("objection").RelationType;
            modelClass: string;
            join: {
                from: string;
                to: string;
            };
        };
    };
}
export type WalletType = ModelObject<Wallet>;
//# sourceMappingURL=Wallet.d.ts.map