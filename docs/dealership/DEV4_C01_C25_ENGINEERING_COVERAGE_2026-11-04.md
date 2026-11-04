# CARUP Dealership 1.0 — C01–C25 engineering coverage as of 4 November 2026

**Authority:** Owner 20-sheet workbook `DEV 4 - Capabilities!A2:G26`, Master Plan v1.1 §0–§11. Source branch is Draft PR #258, unmerged. **This is a source-to-requirement inventory, not final Moderator or human release acceptance.**

| Capability | Required capability | Master owner of truth | Current code/proof pointer | Verified disposition and remaining condition |
|---|---|---|---|---|
| C01 | Dealer prelisting, secure business claim and registration | Registration + Dealer Compliance | dealerResearchService.js + dealerClaimApplicationService.js + reviewer UI | SOURCE_IMPLEMENTED; REAL_HUMAN_REVIEW_UNDONE |
| C02 | Claim-specific PREFILLED dealer Excel registration | Dealer intake domain | dealerIntakeWorkbook.js + dealerWorkbookRoundtrip.js; claim-bound XLSX | CANDIDATE_ENGINEERING_ONLY |
| C03 | Existing Excel/CSV migration | Import + entity crosswalk | dealerCsvIntake.js + dealer-csv-migration.test.js | PARTIAL_NONSTANDARD_CSV; REAL_FILE_PARITY_UNQUALIFIED |
| C04 | AI-assisted field mapping | Governed advisory AI | deterministic human-confirmed CSV/header mapper; no AI service approved | PARTIAL_HUMAN_MAPPING; AI_OPTION_NOT_IMPLEMENTED |
| C05 | Governed OCR document extraction | Document Intelligence | dealerDocumentCandidateService.js, Tesseract/Poppler local default off | SYNTHETIC_ONLY; REAL_DOC_RUNTIME_UNQUALIFIED |
| C06 | Intelligent data validation | Deterministic field registry | dealerWorkbookRoundtrip.js; validations + negative cases | SOURCE_TESTED; COMPLETE_FIELDMAP_NOT_CERTIFIED |
| C07 | Save/resume persistent drafts | Dealer profile/intake storage | dealer_claim_intake_drafts atomic versioning + manual draft | SOURCE_TESTED; USER_RESTART_UAT_UNDONE |
| C08 | Legal company/owner verification | Identity Assurance + Compliance | dealerLegalActivationService.js + SQL 20261103132000 | SOURCE_IMPLEMENTED; REAL_LEGAL_EVIDENCE_UNAVAILABLE |
| C09 | Conditional regulations/licences | Jurisdiction + Dealer Compliance | dealerJurisdictionPreview.js draft conditionals, country policy table | DRAFT_ONLY; LEGAL_SIGNOFF_REQUIRED |
| C10 | Independent compliance approval | Compliance decisions | dealer_record_legal_application_approval SQL, independent password | SOURCE_IMPLEMENTED; POLICY_NOT_APPROVED |
| C11 | Claim-governed approved dealer activation | Corporate/AUTH/tenant service | dealer_activate_approved_legal_claim: canonical org/tenant/member SQL | SOURCE_IMPLEMENTED; REAL_POLICY_DISABLED |
| C12 | Expiry/suspension/renewal | Compliance lifecycle | claim-revoke trigger; dealer active-policy/expiry reads | PARTIAL; RENEWAL_AND_PHYSICAL_INVALIDATION_UNQUALIFIED |
| C13 | Comprehensive operating profile | Dealer operating domain | dealerOperationalDeclarationsService.js, versioned private business terms | SOURCE_IMPLEMENTED; FULL_BUSINESS_OS_NOT_CERTIFIED |
| C14 | Multi-branch and GPS | dealer_branches extension | dealerVerifiedWorkspaceService.js branch create, approved company snapshot | PARTIAL; GPS/HOURS_AND_MULTISITE_RBAC_UNQUALIFIED |
| C15 | Functional dealer dashboard | Domain read models | DealerDashboard.tsx canonical membership/tenant VIN/branch write | SOURCE_IMPLEMENTED; AUTH_BROWSER_UAT_UNDONE |
| C16 | Real staff roles and permissions | Corporate/AUTH memberships | dealerStaffMembershipService.js and staff invitations on tenant_users | SOURCE_IMPLEMENTED; PHYSICAL_RBAC_AND_BRANCH_SCOPE_UNQUALIFIED |
| C17 | Canonical vehicle inventory | Vehicle/Seller/Marketplace | dealerTenantInventoryReadService.js, live first-100 tenant VINs | READ_ONLY; SELLER_OR_BRANCH_LISTING_AUTHORITY_NOT_INTEGRATED |
| C18 | Populated unclaimed + approved dealer directory | Approved public projection | research reviewer queue/SQL, unclaimed directory; actual 104 SQLite audit | REVIEW_WORKFLOW_SOURCE_ONLY; 0 HUMAN_APPROVED_PUBLIC |
| C19 | Stable prelisted-to-full dealer public page | Versioned buyer-safe projection | dealerFullStorefrontService.js; gated full/current public DB view | SOURCE_IMPLEMENTED; ZERO_REAL_FULL_DEALERS |
| C20 | Buyer assurance disclosures | Compliance + vehicle evidence | dealerOperationalDeclarationsService.js BUYER_ASSURANCE; public reviewer | DECLARED_SECTIONS; BUYER_ASSURANCE_UNQUALIFIED |
| C21 | Financing and payments policy | Versioned approved policy | FINANCE_TERMS private declarations; carup/dealer/garage flow separation | DECLARATIONS_ONLY; REAL_PAYMENT_AND_LENDER_BLOCKED |
| C22 | Warranty/after-sales capabilities | Branch operating / policy | WARRANTY_AFTERSALES; SERVICE_CAPABILITIES declared sections | DECLARATIONS_ONLY; PUBLIC_REVIEWED_SERVICES_UNQUALIFIED |
| C23 | Genuine reviews/complaints | Transactions/complaints/moderation | buyer-facing Not measured state; no transaction-backed feedback pipeline | NOT_IMPLEMENTED_TRANSACTION_BACKED_REVIEWS |
| C24 | Approved paid services and subscriptions | PAY-02/03B/04/05 as eligible | dealerCommercialReadinessService.js with all payments disabled | FAIL_CLOSED_READINESS_ONLY; PROVIDER_AND_PR_CONVERGENCE_REQUIRED |
| C25 | Country-specific onboarding | Country rules/version | dealerJurisdictionPreview.js, ZW draft, foreign fail closed | DRAFT_ZW_ONLY; INTERNATIONAL_RULES_UNAPPROVED |

**Source and independent evidence must not be conflated.** The 104-owner-source audit is local SQLite only. Eleven-plus draft migration contracts are isolated, with actual current count and exact-head CI determined by the branch after last commit. No real publication eligibility, country signoff, real dealer pilot, live payment, controlled activation, VIN sale or owner UAT has been certified.
