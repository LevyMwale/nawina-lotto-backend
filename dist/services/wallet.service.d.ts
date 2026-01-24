export declare class WalletService {
    getBalance(userId: string): Promise<{
        balance: number;
        currency: string;
        locked_amount: number;
        available: number;
    }>;
    deduct(userId: string, amount: number, type: 'bet' | 'purchase', metadata?: any): Promise<{
        transaction_id: string;
        new_balance: number;
    }>;
    credit(userId: string, amount: number, type: 'win' | 'deposit' | 'refund', metadata?: any): Promise<{
        transaction_id: string;
        new_balance: number;
    }>;
    deposit(userId: string, amount: number, method: string, details?: {
        mobileNumber?: string;
        cardDetails?: any;
    }): Promise<{
        success: boolean;
        balance: number;
        transactionId: string;
    }>;
    withdraw(userId: string, amount: number, method: string, details?: {
        mobileNumber?: string;
        cardDetails?: any;
    }): Promise<{
        success: boolean;
        balance: number;
        transactionId: string;
    }>;
    getTransactions(userId: string, limit?: number, offset?: number): Promise<{
        id: string;
        type: "deposit" | "withdrawal" | "purchase" | "win" | "refund" | "bet";
        amount: number;
        status: "pending" | "completed" | "failed" | "cancelled";
        reference: string | undefined;
        created_at: Date;
    }[]>;
}
//# sourceMappingURL=wallet.service.d.ts.map