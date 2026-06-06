import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Admin } from '../models/Admin';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

export class AdminService {
  async login(username: string, password: string) {
    const admin = await Admin.query().findOne({ username });
    if (!admin) {
      throw new Error('Invalid username or password');
    }

    if (!admin.is_active) {
      throw new Error('Admin account is deactivated');
    }

    const isValid = await bcrypt.compare(password, admin.password_hash);
    if (!isValid) {
      throw new Error('Invalid username or password');
    }

    // Update last_login
    await Admin.query()
      .patch({ last_login: new Date() })
      .where({ id: admin.id });

    // Generate admin token
    const token = jwt.sign(
      { adminId: admin.id, role: admin.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return {
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        full_name: admin.full_name,
        last_login: admin.last_login,
      },
      token,
    };
  }

  verifyToken(token: string): { adminId: string; role: string } {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      if (!decoded.adminId) {
        throw new Error('Not an admin token');
      }
      return { adminId: decoded.adminId, role: decoded.role };
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  async createAdmin(
    username: string,
    password: string,
    role: 'super_admin' | 'admin' | 'moderator' = 'admin',
    fullName?: string
  ) {
    const existing = await Admin.query().findOne({ username });
    if (existing) {
      throw new Error('Username already exists');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const admin = await Admin.query().insert({
      username,
      password_hash: passwordHash,
      role,
      full_name: fullName,
    });

    return {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      full_name: admin.full_name,
    };
  }

  async listAdmins() {
    return await Admin.query()
      .select('id', 'username', 'role', 'full_name', 'last_login', 'is_active', 'created_at')
      .orderBy('created_at', 'desc');
  }

  /**
   * Change an admin's own password. Self-service only — the caller
   * (route handler) supplies the target adminId from req.adminId, so
   * no one can change someone else's password through this method.
   *
   * Validation:
   *   - currentPassword must match the stored bcrypt hash
   *   - newPassword must be at least 8 chars
   *   - newPassword must differ from currentPassword
   *
   * Cost factor 12 matches createAdmin() so an attacker can't tell
   * new vs. legacy hashes apart by hash time.
   */
  async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const admin = await Admin.query().findById(adminId);
    if (!admin) {
      throw new Error('Admin not found');
    }
    if (!admin.is_active) {
      throw new Error('Admin account is deactivated');
    }

    const valid = await bcrypt.compare(currentPassword, admin.password_hash);
    if (!valid) {
      throw new Error('Current password is incorrect');
    }

    if (!newPassword || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters');
    }
    if (newPassword === currentPassword) {
      throw new Error('New password must be different from the current one');
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await Admin.query()
      .patch({ password_hash: newHash, updated_at: new Date() })
      .where({ id: adminId });
  }
}
