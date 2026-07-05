import pg from 'pg';

const connectionString = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);

const client = new pg.Client({
  connectionString,
});

const sql = `
-- 1. Blockchain events tamper proof triggers
CREATE OR REPLACE FUNCTION check_blockchain_events_tamper()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CRITICAL SECURITY VIOLATION: Historical blockchain ledger modification is strictly forbidden!';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_blockchain_events_update ON blockchain_events;
CREATE TRIGGER prevent_blockchain_events_update
BEFORE UPDATE ON blockchain_events
FOR EACH ROW EXECUTE FUNCTION check_blockchain_events_tamper();

DROP TRIGGER IF EXISTS prevent_blockchain_events_delete ON blockchain_events;
CREATE TRIGGER prevent_blockchain_events_delete
BEFORE DELETE ON blockchain_events
FOR EACH ROW EXECUTE FUNCTION check_blockchain_events_tamper();


-- 2. Partsentry logs tamper proof triggers
CREATE OR REPLACE FUNCTION check_partsentry_logs_tamper()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CRITICAL SECURITY VIOLATION: Modifying service logs is strictly forbidden!';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_partsentry_update ON partsentry_logs;
CREATE TRIGGER prevent_partsentry_update
BEFORE UPDATE ON partsentry_logs
FOR EACH ROW EXECUTE FUNCTION check_partsentry_logs_tamper();

DROP TRIGGER IF EXISTS prevent_partsentry_delete ON partsentry_logs;
CREATE TRIGGER prevent_partsentry_delete
BEFORE DELETE ON partsentry_logs
FOR EACH ROW EXECUTE FUNCTION check_partsentry_logs_tamper();


-- 3. OCR documents tamper proof triggers
CREATE OR REPLACE FUNCTION check_ocr_documents_tamper()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CRITICAL SECURITY VIOLATION: Processed OCR documents modification is strictly forbidden!';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_ocr_documents_update ON ocr_documents;
CREATE TRIGGER prevent_ocr_documents_update
BEFORE UPDATE ON ocr_documents
FOR EACH ROW EXECUTE FUNCTION check_ocr_documents_tamper();

DROP TRIGGER IF EXISTS prevent_ocr_documents_delete ON ocr_documents;
CREATE TRIGGER prevent_ocr_documents_delete
BEFORE DELETE ON ocr_documents
FOR EACH ROW EXECUTE FUNCTION check_ocr_documents_tamper();


-- 4. Financial ledger tamper proof triggers
CREATE OR REPLACE FUNCTION check_financial_ledger_tamper()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CRITICAL SECURITY VIOLATION: Transactional ledger entries modification is strictly forbidden!';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_financial_ledger_update ON financial_ledger;
CREATE TRIGGER prevent_financial_ledger_update
BEFORE UPDATE ON financial_ledger
FOR EACH ROW EXECUTE FUNCTION check_financial_ledger_tamper();

DROP TRIGGER IF EXISTS prevent_financial_ledger_delete ON financial_ledger;
CREATE TRIGGER prevent_financial_ledger_delete
BEFORE DELETE ON financial_ledger
FOR EACH ROW EXECUTE FUNCTION check_financial_ledger_tamper();
`;

async function deployTriggers() {
  try {
    await client.connect();
    console.log('📡 Connected successfully to Supabase PostgreSQL Database.');
    console.log('🤖 Creating database tamper-proofing triggers...');
    await client.query(sql);
    console.log('✅ ALL TAMPER-PROOFING TRIGGERS APPLIED SUCCESSFULLY TO SUPABASE.');
  } catch (err) {
    console.error('❌ Trigger deployment failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

deployTriggers();
