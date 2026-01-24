"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.knexConfig = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables FIRST
dotenv_1.default.config();
exports.knexConfig = {
    client: 'postgresql',
    connection: {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'nawina_lotto',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
    },
    pool: {
        min: 2,
        max: 10,
    },
    migrations: {
        directory: './src/database/migrations',
        extension: 'ts',
    },
    seeds: {
        directory: './src/database/seeds',
        extension: 'ts',
    },
};
//# sourceMappingURL=database.js.map