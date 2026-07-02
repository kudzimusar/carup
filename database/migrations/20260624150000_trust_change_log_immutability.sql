-- +migrate Up
-- Phase 6 — Trust Change Log Immutability
--
-- trust_change_log records every governed trust mutation.  Any post-hoc alteration
-- (UPDATE or DELETE) would destroy the audit evidence of why a vehicle's trust score
-- changed.  This migration adds append-only enforcement using governance_block_mutation(),
-- which is already defined by migration 20260621160000_governance_disputes_corrections.sql.

DROP TRIGGER IF EXISTS trust_change_log_no_update ON trust_change_log;
CREATE TRIGGER trust_change_log_no_update
  BEFORE UPDATE ON trust_change_log
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

DROP TRIGGER IF EXISTS trust_change_log_no_delete ON trust_change_log;
CREATE TRIGGER trust_change_log_no_delete
  BEFORE DELETE ON trust_change_log
  FOR EACH ROW EXECUTE FUNCTION governance_block_mutation();

-- +migrate Down
DROP TRIGGER IF EXISTS trust_change_log_no_update ON trust_change_log;
DROP TRIGGER IF EXISTS trust_change_log_no_delete ON trust_change_log;
-- governance_block_mutation() is retained: it protects other governed tables.
