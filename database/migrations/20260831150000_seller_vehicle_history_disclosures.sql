-- +migrate Up
-- =====================================================================================
-- Seller Vehicle History & Obligations disclosures (DESIGN.md §11.7; master plan §0.7,
-- F18–F20, M17). Three nullable JSONB columns on public.vehicles carrying the Seller's
-- OWN structured statements about accident history, current insurance, and an existing
-- finance/lease/lender interest attached to the vehicle being sold.
--
-- Truth rules enforced at the schema level:
--   • NULL = the Seller has not answered. Absence is rendered "not recorded" by every
--     read surface — it never becomes "no accident", "not insured" or "finance clear".
--     There is deliberately NO DEFAULT on any of these columns.
--   • The `state` key is a CLOSED vocabulary (CHECK below). An out-of-vocabulary value
--     is refused by the database even if a code path forgets to validate.
--   • Seller finance disclosures may NEVER carry private banking terms (M17/INV-18):
--     a CHECK bans the sensitive keys outright, mirroring the pattern used by
--     finance_provider_decisions.decision_inputs_snapshot (20260703150000). The
--     backend refuses them first; this is defense in depth, not the primary gate.
--
-- These columns are SELLER STATEMENTS (seller_* prefix, same authority class as
-- seller_description). Governed truth lives elsewhere and is never written here:
-- accident evidence in vehicle_evidence (evidence_class 'accident'/'repair'),
-- insurer truth in insurance_records / the insurer provider workflow, lender truth in
-- the finance/lender provider workflow. Additive and reversible.
-- =====================================================================================

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS seller_accident_disclosure JSONB;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS seller_insurance_disclosure JSONB;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS seller_finance_disclosure JSONB;

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_seller_accident_disclosure_state_chk;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_seller_accident_disclosure_state_chk CHECK (
  seller_accident_disclosure IS NULL
  OR (seller_accident_disclosure->>'state') IN ('yes', 'no_known_accident_history', 'unknown')
);

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_seller_insurance_disclosure_state_chk;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_seller_insurance_disclosure_state_chk CHECK (
  seller_insurance_disclosure IS NULL
  OR (seller_insurance_disclosure->>'state') IN ('insured', 'not_insured', 'unknown')
);

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_seller_finance_disclosure_state_chk;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_seller_finance_disclosure_state_chk CHECK (
  seller_finance_disclosure IS NULL
  OR (
    (seller_finance_disclosure->>'state') IN ('none_known', 'active', 'settlement_pending', 'cleared', 'unknown')
    AND (
      seller_finance_disclosure->>'finance_type' IS NULL
      OR (seller_finance_disclosure->>'finance_type') IN
        ('bank_loan', 'vehicle_finance', 'lease', 'hire_purchase', 'secured_lien', 'other')
    )
  )
);

-- M17 / INV-18: private banking terms are structurally banned from the Seller disclosure column.
-- Keys mirror PRIVATE_FINANCE_KEYS in backend/services/seller/vehicleHistoryDisclosures.js.
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_seller_finance_disclosure_privacy_chk;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_seller_finance_disclosure_privacy_chk CHECK (
  seller_finance_disclosure IS NULL
  OR NOT (seller_finance_disclosure ?| ARRAY[
    'outstanding_balance', 'monthly_payment', 'apr', 'interest_rate',
    'account_number', 'loan_reference', 'contract_number', 'bank_account',
    'repayment_history', 'credit_score', 'credit_report'
  ])
);

-- +migrate Down
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_seller_finance_disclosure_privacy_chk;
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_seller_finance_disclosure_state_chk;
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_seller_insurance_disclosure_state_chk;
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_seller_accident_disclosure_state_chk;
ALTER TABLE vehicles DROP COLUMN IF EXISTS seller_finance_disclosure;
ALTER TABLE vehicles DROP COLUMN IF EXISTS seller_insurance_disclosure;
ALTER TABLE vehicles DROP COLUMN IF EXISTS seller_accident_disclosure;
