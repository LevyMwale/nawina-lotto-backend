import { Model, ModelObject } from 'objection';
export declare class GamePlay extends Model {
    static tableName: string;
    id: string;
    user_id: string;
    game_type: string;
    stake: number;
    bet_data?: any;
    result: any;
    payout: number;
    rng_seed: string;
    house_edge?: number;
    created_at: Date;
}
export type GamePlayType = ModelObject<GamePlay>;
//# sourceMappingURL=GamePlay.d.ts.map