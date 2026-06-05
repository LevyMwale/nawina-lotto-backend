import { Model, ModelObject } from 'objection';

export class Admin extends Model {
  static tableName = 'admins';

  id!: string;
  username!: string;
  password_hash!: string;
  role!: 'super_admin' | 'admin' | 'moderator';
  full_name?: string;
  last_login?: Date;
  is_active!: boolean;
  created_at!: Date;
  updated_at!: Date;
}

export type AdminType = ModelObject<Admin>;
