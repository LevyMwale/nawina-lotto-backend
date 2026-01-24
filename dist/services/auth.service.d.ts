export declare class AuthService {
    register(phone: string, pin: string, fullName?: string): Promise<{
        user: {
            id: string;
            phone: string;
            full_name: string | undefined;
            kyc_status: "pending" | "verified" | "rejected";
        };
        token: string;
    }>;
    login(phone: string, pin: string): Promise<{
        user: {
            id: string;
            phone: string;
            full_name: string | undefined;
            kyc_status: "pending" | "verified" | "rejected";
            balance: number;
        };
        token: string;
    }>;
    private generateToken;
    verifyToken(token: string): {
        userId: string;
    };
}
//# sourceMappingURL=auth.service.d.ts.map