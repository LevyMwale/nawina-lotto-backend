import { Model, ModelObject } from 'objection';
export declare class Transaction extends Model {
    static tableName: string;
    id: string;
    wallet_id: string;
    type: 'deposit' | 'withdrawal' | 'purchase' | 'win' | 'refund' | 'bet';
    amount: number;
    balance_before: number;
    balance_after: number;
    status: 'pending' | 'completed' | 'failed' | 'cancelled';
    reference?: string;
    description?: string;
    metadata?: any;
    created_at: Date;
    static relationMappings: {
        wallet: {
            relation: import("objection").RelationType;
            modelClass: string;
            join: {
                from: string;
                to: string;
            };
        };
    };
}
export type TransactionType = ModelObject<Transaction>;
//# sourceMappingURL=Transaction.d.ts.map