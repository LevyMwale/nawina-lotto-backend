import { Knex } from "knex";
import bcrypt from "bcrypt";

export async function seed(knex: Knex): Promise<void> {
  // Clear existing data (only from tables that exist)
  await knex("wallets").del();
  await knex("users").del();

  // Insert admin user
  const hashedPin = await bcrypt.hash("1234", 10);

  const [adminUser] = await knex("users")
    .insert({
      phone: "+260971234567",
      pin_hash: hashedPin,
      full_name: "Admin User",
      kyc_status: "verified",
      is_active: true,
    })
    .returning("*");

  // Create wallet for admin
  await knex("wallets").insert({
    user_id: adminUser.id,
    balance: 1000.0,
    currency: "ZMW",
  });

  // Insert sample user
  const hashedUserPin = await bcrypt.hash("5678", 10);

  const [sampleUser] = await knex("users")
    .insert({
      phone: "+260977654321",
      pin_hash: hashedUserPin,
      full_name: "Test User",
      kyc_status: "verified",
      is_active: true,
    })
    .returning("*");

  // Create wallet for sample user
  await knex("wallets").insert({
    user_id: sampleUser.id,
    balance: 500.0,
    currency: "ZMW",
  });

  console.log("✅ Seed data inserted successfully!");
  console.log("📱 Admin: +260971234567 (PIN: 1234)");
  console.log("📱 Test User: +260977654321 (PIN: 5678)");
}