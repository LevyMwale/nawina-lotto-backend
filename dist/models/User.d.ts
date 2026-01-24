import { Model, ModelObject } from 'objection';
import { Wallet } from './Wallet';
export declare class User extends Model {
    static tableName: string;
    id: string;
    phone: string;
    pin_hash: string;
    full_name?: string;
    national_id?: string;
    kyc_status: 'pending' | 'verified' | 'rejected';
    date_of_birth?: Date;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    wallet?: Wallet;
    static relationMappings: {
        wallet: {
            relation: import("objection").RelationType;
            modelClass: typeof Wallet;
            join: {
                from: string;
                to: string;
            };
        };
    };
}
export type UserType = ModelObject<User>;
//# sourceMappingURL=User.d.ts.map