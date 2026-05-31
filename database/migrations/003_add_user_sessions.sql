-- +migrate Up

-- 1. Create secure sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  active_role TEXT NOT NULL,
  active_organization_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (active_organization_id) REFERENCES organizations(id) ON DELETE SET NULL
);

-- 2. Create role switch logs table to trace contexts
CREATE TABLE IF NOT EXISTS role_switch_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  previous_role TEXT NOT NULL,
  requested_role TEXT NOT NULL,
  organization_id TEXT,
  timestamp TEXT NOT NULL,
  success INTEGER DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Create security events table to log MFA and suspicious switches
CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  event_type TEXT NOT NULL, -- 'MFA_FAILURE', 'UNAUTHORIZED_ACCESS', 'IMPERSONATION_ATTEMPT'
  details TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  severity TEXT CHECK(severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  timestamp TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 4. Create failed auth attempts table for brute-force tracking
CREATE TABLE IF NOT EXISTS failed_auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip_address TEXT,
  timestamp TEXT NOT NULL,
  attempt_count INTEGER DEFAULT 1
);

-- 5. Index security structures
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_role_switch_user ON role_switch_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_failed_auth_email ON failed_auth_attempts(email);

-- +migrate Down
DROP TABLE IF EXISTS failed_auth_attempts;
DROP TABLE IF EXISTS security_events;
DROP TABLE IF EXISTS role_switch_logs;
DROP TABLE IF EXISTS user_sessions;
