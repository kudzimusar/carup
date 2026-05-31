import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, 'carup.db');

let db = null;

export async function getDb() {
  if (db) return db;

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

function calculateSeedHash(previousHash, vin, eventType, timestamp, payload) {
  const data = previousHash + vin + eventType + timestamp + JSON.stringify(payload);
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function initDb() {
  const connection = await getDb();

  // Create tables
  await connection.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      avatar TEXT,
      role TEXT NOT NULL,
      phone TEXT,
      location TEXT,
      is_verified INTEGER DEFAULT 0,
      subscription TEXT DEFAULT 'Free',
      join_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stakeholder_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      stakeholder_type TEXT NOT NULL,
      organization_name TEXT,
      status TEXT DEFAULT 'Active',
      kyc_status TEXT DEFAULT 'Pending',
      trust_score REAL DEFAULT 50.0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      vin TEXT PRIMARY KEY,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      generation TEXT,
      trim TEXT,
      year INTEGER NOT NULL,
      color TEXT,
      mileage INTEGER NOT NULL,
      fuel_type TEXT,
      drivetrain TEXT,
      transmission TEXT,
      import_source TEXT,
      duty_paid INTEGER DEFAULT 0,
      police_verified INTEGER DEFAULT 0,
      status TEXT DEFAULT 'Available',
      trust_score REAL DEFAULT 80.0,
      price REAL NOT NULL,
      currency TEXT DEFAULT 'USD'
    );

    CREATE TABLE IF NOT EXISTS blockchain_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      previous_hash TEXT NOT NULL,
      current_hash TEXT NOT NULL,
      vin TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      signature TEXT,
      FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS safepay_escrows (
      id TEXT PRIMARY KEY,
      vin TEXT NOT NULL,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      status TEXT NOT NULL, -- 'Pending', 'Escrowed', 'Inspecting', 'Completed', 'Disputed'
      fee_split_zimra REAL NOT NULL,
      fee_split_escrow REAL NOT NULL,
      current_stage INTEGER DEFAULT 1,
      dispute_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE,
      FOREIGN KEY (buyer_id) REFERENCES users(id),
      FOREIGN KEY (seller_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS partsentry_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vin TEXT NOT NULL,
      mechanic_id TEXT NOT NULL,
      part_name TEXT NOT NULL,
      part_oem TEXT,
      action_type TEXT NOT NULL, -- 'Replaced', 'Repaired', 'Inspected'
      description TEXT,
      mileage INTEGER NOT NULL,
      signature TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE,
      FOREIGN KEY (mechanic_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS vehicle_ownership_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vin TEXT NOT NULL,
      previous_owner_id TEXT,
      new_owner_id TEXT NOT NULL,
      transfer_date TEXT NOT NULL,
      transfer_hash TEXT NOT NULL,
      FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE,
      FOREIGN KEY (new_owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS insurance_records (
      id TEXT PRIMARY KEY,
      vin TEXT NOT NULL,
      insurer_id TEXT NOT NULL,
      policy_number TEXT NOT NULL UNIQUE,
      coverage_details TEXT,
      premium_amount REAL NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      risk_score REAL DEFAULT 50.0,
      FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE,
      FOREIGN KEY (insurer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS finance_applications (
      id TEXT PRIMARY KEY,
      vin TEXT NOT NULL,
      user_id TEXT NOT NULL,
      bank_id TEXT NOT NULL,
      requested_amount REAL NOT NULL,
      status TEXT DEFAULT 'Pending', -- 'Pending', 'Approved', 'Rejected'
      monthly_payment REAL NOT NULL,
      apr REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (vin) REFERENCES vehicles(vin) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (bank_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL, -- 'dealership', 'garage', 'insurance', 'bank', 'fleet', 'import', 'government'
      created_at TEXT NOT NULL,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS organization_profiles (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      tax_id TEXT,
      license_number TEXT,
      phone TEXT,
      address TEXT,
      location TEXT,
      trust_score REAL DEFAULT 50.0,
      logo TEXT,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS organization_roles (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL, -- 'Owner', 'Administrator', 'Sales Agent', 'Certified Mechanic', 'Risk Analyst', 'Loan Officer', 'Customs Officer'
      level INTEGER NOT NULL, -- 1 to 5
      description TEXT,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS organization_users (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      department_id TEXT,
      branch_id TEXT,
      status TEXT DEFAULT 'active',
      joined_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES organization_roles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS organization_permissions (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL,
      resource TEXT NOT NULL, -- 'inventory', 'finance', 'claims', 'inspections', 'users'
      action TEXT NOT NULL, -- 'read', 'write', 'approve', 'all'
      FOREIGN KEY (role_id) REFERENCES organization_roles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS organization_branches (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      phone TEXT,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS organization_departments (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      manager_id TEXT,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS organization_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      details TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      ip_address TEXT,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS organization_ai_agents (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL, -- 'pricing_copilot', 'diagnostics_copilot', 'risk_copilot', 'fraud_copilot'
      status TEXT DEFAULT 'active',
      last_active TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS organization_settings (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      UNIQUE(organization_id, key)
    );
  `);

  // Seed default database values if empty
  const userCount = await connection.get('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    console.log('Seeding initial database values...');
    
    // Seed default Users
    await connection.run(`
      INSERT INTO users (id, name, email, avatar, role, phone, location, is_verified, subscription, join_date)
      VALUES 
        ('u1', 'Tendai Moyo', 'tendai@email.co.zw', '/images/avatars/owner-1.jpg', 'owner', '+263 773 345 678', 'Harare', 1, 'Premium', '2024-03-15'),
        ('u2', 'Simbisa Garages', 'contact@simbisa.co.zw', '/images/avatars/mechanic-1.jpg', 'mechanic', '+263 772 111 222', 'Bulawayo', 1, 'Enterprise', '2023-08-10'),
        ('u3', 'Croco Motors', 'sales@crocomotors.co.zw', '/images/avatars/dealer-1.jpg', 'dealer', '+263 774 444 555', 'Harare', 1, 'Enterprise', '2022-01-05'),
        ('u4', 'Old Mutual Insurance', 'insurance@oldmutual.co.zw', '/images/avatars/insurance-1.jpg', 'insurance', '+263 771 999 888', 'Harare', 1, 'Enterprise', '2021-06-20'),
        ('u5', 'ZIMRA Registry', 'registry@zimra.co.zw', '/images/avatars/government-1.jpg', 'government', '+263 242 758 891', 'Harare', 1, 'System', '2020-01-01');
    `);

    // Seed default Stakeholder Profiles
    await connection.run(`
      INSERT INTO stakeholder_profiles (id, user_id, stakeholder_type, organization_name, status, kyc_status, trust_score)
      VALUES 
        ('sp1', 'u1', 'Buyer', 'Individual', 'Active', 'Verified', 92.5),
        ('sp2', 'u2', 'Mechanic', 'Simbisa Garages Ltd', 'Active', 'Verified', 95.0),
        ('sp3', 'u3', 'Dealer', 'Croco Motors Group', 'Active', 'Verified', 98.2),
        ('sp4', 'u4', 'Insurer', 'Old Mutual Zimbabwe', 'Active', 'Verified', 99.0),
        ('sp5', 'u5', 'Government', 'Zimbabwe Revenue Authority', 'Active', 'Verified', 100.0);
    `);

    // Seed default Vehicles
    await connection.run(`
      INSERT INTO vehicles (vin, make, model, generation, trim, year, color, mileage, fuel_type, drivetrain, transmission, import_source, duty_paid, police_verified, status, trust_score, price, currency)
      VALUES 
        ('VIN74329849204928', 'Toyota', 'Hilux', 'GD-6', 'Double Cab Legend 50', 2021, 'White', 48500, 'Diesel', '4WD', 'Automatic', 'South Africa', 1, 1, 'Available', 96.8, 42000.0, 'USD'),
        ('VIN89230489201948', 'Mercedes-Benz', 'C-Class', 'W205', 'C200 AMG Line', 2019, 'Grey', 72000, 'Petrol', 'RWD', 'Automatic', 'United Kingdom', 1, 1, 'Available', 91.2, 28500.0, 'USD'),
        ('VIN38492049281048', 'Mazda', 'Demio', '4th Gen', 'SkyActiv-G', 2017, 'Blue', 112000, 'Petrol', 'FWD', 'Automatic', 'Japan', 1, 1, 'Available', 84.5, 7500.0, 'USD');
    `);

    // Seed Organizations
    await connection.run(`
      INSERT INTO organizations (id, name, type, created_at, status)
      VALUES
        ('org_croco', 'Croco Motors Group', 'dealership', '2022-01-05', 'active'),
        ('org_simbisa', 'Simbisa Garages Ltd', 'garage', '2023-08-10', 'active'),
        ('org_oldmutual', 'Old Mutual Zimbabwe', 'insurance', '2021-06-20', 'active'),
        ('org_cbz', 'CBZ Bank Limited', 'bank', '2019-03-12', 'active'),
        ('org_zimra', 'Zimbabwe Revenue Authority', 'government', '2020-01-01', 'active');
    `);

    // Seed Organization Profiles
    await connection.run(`
      INSERT INTO organization_profiles (id, organization_id, tax_id, license_number, phone, address, location, trust_score, logo)
      VALUES
        ('prof_croco', 'org_croco', 'TIN-928392-D', 'LIC-DEALER-452', '+263 774 444 555', '100 Leopold Takawira St, Harare', 'Harare', 98.2, '/images/logos/croco.jpg'),
        ('prof_simbisa', 'org_simbisa', 'TIN-112233-G', 'LIC-GARAGE-882', '+263 772 111 222', '12 Robert Mugabe Way, Bulawayo', 'Bulawayo', 95.0, '/images/logos/simbisa.jpg'),
        ('prof_oldmutual', 'org_oldmutual', 'TIN-999888-I', 'LIC-INS-332', '+263 771 999 888', '100 Mutual Gardens, Harare', 'Harare', 99.0, '/images/logos/oldmutual.jpg'),
        ('prof_cbz', 'org_cbz', 'TIN-888777-B', 'LIC-BANK-110', '+263 867 700 2000', '60 Kwame Nkrumah Ave, Harare', 'Harare', 97.5, '/images/logos/cbz.jpg'),
        ('prof_zimra', 'org_zimra', 'TIN-000001-G', 'LIC-GOV-001', '+263 242 758 891', 'Kurima House, Nelson Mandela Ave, Harare', 'Harare', 100.0, '/images/logos/zimra.jpg');
    `);

    // Seed Organization Roles
    await connection.run(`
      INSERT INTO organization_roles (id, organization_id, name, level, description)
      VALUES
        ('role_croco_owner', 'org_croco', 'Owner', 2, 'Full ownership of Croco Motors dealership'),
        ('role_croco_admin', 'org_croco', 'Administrator', 3, 'Branch management and inventory approval'),
        ('role_croco_staff', 'org_croco', 'Sales Agent', 4, 'Upload inventory and view leads'),
        ('role_simbisa_mechanic', 'org_simbisa', 'Certified Mechanic', 4, 'Append and sign service history logs'),
        ('role_oldmutual_underwriter', 'org_oldmutual', 'Risk Analyst', 4, 'Policy underwriting and claims review'),
        ('role_cbz_officer', 'org_cbz', 'Loan Officer', 4, 'Assess financing applications'),
        ('role_zimra_officer', 'org_zimra', 'Customs Officer', 4, 'Verify ZIMRA declarations');
    `);

    // Seed Organization Branches
    await connection.run(`
      INSERT INTO organization_branches (id, organization_id, name, location, phone)
      VALUES
        ('branch_croco_hre', 'org_croco', 'Harare Central Branch', 'Harare', '+263 774 444 555'),
        ('branch_croco_byo', 'org_croco', 'Bulawayo Showroom', 'Bulawayo', '+263 9 77889'),
        ('branch_simbisa_byo', 'org_simbisa', 'Bulawayo Main Workshop', 'Bulawayo', '+263 772 111 222'),
        ('branch_oldmutual_hre', 'org_oldmutual', 'Harare HQ Office', 'Harare', '+263 771 999 888');
    `);

    // Seed Organization Users
    await connection.run(`
      INSERT INTO organization_users (id, organization_id, user_id, role_id, department_id, branch_id, status, joined_at)
      VALUES
        ('ou_simbisa_u2', 'org_simbisa', 'u2', 'role_simbisa_mechanic', NULL, 'branch_simbisa_byo', 'active', '2023-08-10'),
        ('ou_croco_u3', 'org_croco', 'u3', 'role_croco_owner', NULL, 'branch_croco_hre', 'active', '2022-01-05'),
        ('ou_oldmutual_u4', 'org_oldmutual', 'u4', 'role_oldmutual_underwriter', NULL, 'branch_oldmutual_hre', 'active', '2021-06-20'),
        ('ou_zimra_u5', 'org_zimra', 'u5', 'role_zimra_officer', NULL, NULL, 'active', '2020-01-01');
    `);

    // Seed Organization Departments
    await connection.run(`
      INSERT INTO organization_departments (id, organization_id, name, manager_id)
      VALUES
        ('dept_croco_sales', 'org_croco', 'Sales & Marketing', 'u3'),
        ('dept_croco_inv', 'org_croco', 'Inventory & Operations', 'u3');
    `);

    // Seed Organization AI Agents
    await connection.run(`
      INSERT INTO organization_ai_agents (id, organization_id, name, type, status, last_active)
      VALUES
        ('ai_croco_pricing', 'org_croco', 'Dealer Pricing Advisor', 'pricing_copilot', 'active', '2026-05-26T16:00:00Z'),
        ('ai_simbisa_diag', 'org_simbisa', 'Gutu Repair Diagnostician', 'diagnostics_copilot', 'active', '2026-05-26T16:00:00Z'),
        ('ai_oldmutual_risk', 'org_oldmutual', 'Risk Analyzer Agent', 'risk_copilot', 'active', '2026-05-26T16:00:00Z');
    `);

    // Seed Organization Settings
    await connection.run(`
      INSERT INTO organization_settings (id, organization_id, key, value)
      VALUES
        ('set_croco_currency', 'org_croco', 'default_currency', 'USD'),
        ('set_simbisa_approval', 'org_simbisa', 'require_client_approval', 'true');
    `);

    // Seed Organization Audit Logs
    await connection.run(`
      INSERT INTO organization_audit_logs (organization_id, user_id, action, resource, details, timestamp, ip_address)
      VALUES
        ('org_croco', 'u3', 'CREATE_LISTING', 'inventory', 'Created listing for Toyota Hilux VIN74329849204928', '2026-05-26T12:05:00Z', '192.168.1.10'),
        ('org_simbisa', 'u2', 'ADD_REPAIR_LOG', 'partsentry', 'Appended partsentry log for suspension replacement', '2026-05-26T14:15:00Z', '192.168.1.15');
    `);

    // Seed initial Cryptographic event logs dynamically calculating valid SHA-256 hashes
    const vin = 'VIN74329849204928';
    const timestamp1 = '2026-05-26T12:00:00Z';
    const payload1 = { owner: 'Tendai Moyo', cvr_registered: true, zimra_duty_status: 'Cleared' };
    const prevHash1 = '0000000000000000000000000000000000000000000000000000000000000000';
    const currentHash1 = calculateSeedHash(prevHash1, vin, 'Registry Verification', timestamp1, payload1);

    const timestamp2 = '2026-05-26T14:00:00Z';
    const payload2 = { garage: 'Simbisa Garages', odometer: 42000, status: 'Passed', notes: 'Standard 40k service completed' };
    const currentHash2 = calculateSeedHash(currentHash1, vin, 'Mechanic Inspection', timestamp2, payload2);

    await connection.run(`
      INSERT INTO blockchain_events (previous_hash, current_hash, vin, event_type, payload, timestamp, signature)
      VALUES (?, ?, ?, ?, ?, ?, 'SYSTEM_SIGNATURE')
    `, [prevHash1, currentHash1, vin, 'Registry Verification', JSON.stringify(payload1), timestamp1]);

    await connection.run(`
      INSERT INTO blockchain_events (previous_hash, current_hash, vin, event_type, payload, timestamp, signature)
      VALUES (?, ?, ?, ?, ?, ?, 'SYSTEM_SIGNATURE')
    `, [currentHash1, currentHash2, vin, 'Mechanic Inspection', JSON.stringify(payload2), timestamp2]);

    console.log('Seeding completed successfully!');
  }
  
  // Run all migrations dynamically on startup
  await runMigrations('up');
}
