# CR-1 Execution Ledger (no secrets) — opened 2026-07-26

Owner authorization: merge PR #122, rotation coordination, history rewrite + force-with-lease, fresh clones, CR-1 closure. NOT authorized: production migrations/deploy/feature activation/EB-5.

## Baseline
- main: 08463d8ede9b54c39aace1e5b28a49fa87e0bdac
- PR #122 head: b901949d947234733b88c40a13a4ec9547f53baa (base main, CLEAN/MERGEABLE, draft)
- preserved ref: refs/preserved/diaspora-wip-cc42b41 -> 0052fd395f7ee6c e0a3... (0052fd395f7ee6ce6c6df5f5616471b028df6efe)
- rc tag: rc/diaspora-9164500 (tag obj 7397d163) -> commit 91645006f4d3

## Remote branches (84)
- origin 08463d8ede9b54c39aace1e5b28a49fa87e0bdac
- origin/checkpoint/evidence-before-commit 7a8b609c6d990bc7dc9c5d170c0e7a21bb5c609e
- origin/chore/production-readiness-stabilization 23d521d712142b8798fb259891278a955d09e46b
- origin/claude/diaspora-phases-3-7-program bbcf42177680b3ad3e443bdf144de4718c2cd896
- origin/claude/diaspora-phases-8-10-production-program 85101738638192b45d6777505c542c434a5181f7
- origin/codex/admin-government-trust-review-ui 918f1a381ad371c26fb007fee76c77ed3ace74ad
- origin/codex/assess-project-progress-and-capabilities bbf5cb9c0033edcb032e192ef8b41249391eeee4
- origin/codex/assess-project-progress-and-capabilities-nl9tp5 0ca92f6557818628a78d7d15526bcac981ee9f31
- origin/codex/backend-listing-summary-infra 42fe7e93f204a24d3d3905730e3e0f6c1361328b
- origin/codex/diaspora-buyer-import-ui-v1 ae382f57739f3c2d5c23f9f800bec9b1f7bd5d43
- origin/codex/diaspora-document-upload-ui-v1 4b24a33764db3c6c09077fa42bb4c4787e0bd148
- origin/codex/diaspora-shipment-read-scoping 05c7e9b48020a9277f7e49f08a65e7c2cc73d65f
- origin/codex/fix-stale-session-handling 9154e543170717cbccdf8eac38aad41dd2a5ebef
- origin/codex/governance-foundation-audit-auth ce8149c4a29d71735ea5ffe620e2d904f0b915b1
- origin/codex/homepage-visual-polish-seller-conversion a1758f94d9a4670a1f58c8f67a5b32ddf6600ebc
- origin/codex/hotfix-production-cors-login 157d2fe5ff11da66d909aae97e251fcb70e21b8b
- origin/codex/navigation-intelligence-blueprint-completion 8091f337fbcf5ad5e694ca319ea0e92528ff814e
- origin/codex/navigation-partsentry-marketplace-cards a04aef0855e4683a21e968e27790f00f33951846
- origin/codex/partsentry-public-card-approval-backend 854c0cdd3757d370fca30070a6a3982695afbc11
- origin/codex/trust-fact-setters-phase2a 3654f0a395e83a6a335b9a0144cdb6c1f44f4205
- origin/docs/agent-8-omnichannel-communication-goal-loop 8dbb37907d02b756042a67c8af1336717cfab216
- origin/docs/claude-diaspora-phases-3-7-master-directive 32744d7642e679e40bb19dd3403bc36901d3ef37
- origin/docs/claude-diaspora-remaining-phases-production-directive a1b5b738877f28fb312591b12519337e462c2ee1
- origin/docs/feature-registry-completion-master-plan 8571790198a20a0276b8b8ba63f6b0110fc850c6
- origin/docs/issue77-containment-goal-loop 89467b56cd8de1e18806a5bc7bdb3a11d75edd81
- origin/docs/marketplace-v1-completion-goal c182081319e86ad38c009e9daaaf8ddb2d6675b2
- origin/docs/navigation-intelligence-governance a05dbf15f9c5a39dedad78c24cc3af0047b830cf
- origin/docs/phase7c-production-completion b24459047b9629d4c3b3fafdc4f3740eb8fd28e7
- origin/docs/referral-final-uat-release-goal-loop 8045c8d559d08dd70db904e7c760ee282e7c34ac
- origin/docs/referral-full-vision-mvp-completion c56d920c1b5978feee00a9b33650b9b7a0508bfb
- origin/docs/referral-v1-stage0-baseline aa775a20801c3329a693788fa92b2d6020719498
- origin/docs/referral-v1-stage5-closure cb930115f2dcb776c5ee25b83ef6e5ff7644594d
- origin/docs/release-candidate-integration-sprint 4f84c185d61ff1f066051f655b88a93034c086f2
- origin/docs/vehicle-life-intelligence-master-plan d242c25d4587be205bd1e3601e394ba7603a7831
- origin/feat/referral-final-uat-release e7a2f60afc35a90ffad3b17352e459742fb6d10b
- origin/feat/referral-wave-a-identity-attribution 163a46fc16a22c633537ed3f3067a2f8b59beeb2
- origin/feat/vehicle-life-m1-taxonomy-provenance 6c885d01611f1b8d051f2fe276e34685fe18e3e5
- origin/feat/vehicle-life-m2-ingestion a174bef57018d83aa91dc33cfacfa2b85c57a5f8
- origin/feat/vehicle-life-m3-ai-temporal-disclosure 12a2bbc87828e50247af318fa24840d97dad50aa
- origin/feat/vehicle-life-m4-buyer-report 0d5ac0c8ac098d6becffb5c21804971ebf5d90bd
- origin/feat/vehicle-life-m5-governance ae2365721331df869a047aded16ca54ffb7e609e
- origin/feat/vehicle-life-m6-infra-validation cf721adc98312cecf13931bb21cf6a7b473a262a
- origin/feature/agent-8-omnichannel-communication-engine 920de0f916e144e38ecf5458b6038b42ee28091e
- origin/feature/marketplace-first-homepage eb23a07d0243a099fdd6b9c0398803737458f5ec
- origin/feature/marketplace-v1-production-integration dc1dabe5f4ed40bc582f27224593f5cae247bc77
- origin/feature/mobile-registry-drawer d66375c8f207f35fc0354351c6993590419b495a
- origin/feature/referral-engine-phase1 83c7c66a960a75e674755747bfb9625a724f84b6
- origin/feature/referral-engine-phase2-agent-gateway 346e743ce0ff41cfa3c126578db900ce3f15e70e
- origin/feature/referral-engine-phase3-channels 3ace33d6584448341f1ddc4b2beabaa2b5146d36
- origin/feature/referral-engine-phase4-local-marketplace 4df67624113f86221ed64d34787cc7e4d76ddecc
- origin/feature/referral-engine-phase5-imports 587533ad483ee2e467c571f200b80e4b5b9af56e
- origin/feature/referral-engine-phase6-ai-marketing 7cc267d6e77a3989985f2ac5d8109d293be34043
- origin/feature/referral-engine-phase7-trust-review 7831f3622fbf2a86fff64e0354e1b01d112e90f8
- origin/feature/vehicle-evidence-upload-flow 58039e001fbdb8aecf1eed0363ec19afbc78efc7
- origin/fix/evidence-backend-blockers 6501442277b8b3891232c4f3d3079737afeb438f
- origin/fix/issue-108-agent8-admin-reply-queue d02f9a1859d31db03f3e208c5fd0bcecc130a670
- origin/fix/referral-v1-post-stage4-governance 19d64aeef68f0265752f6eec2dfd94ac21591be5
- origin/fix/referral-v1-stage4-journey-closure dd50e8514ecf06efc270411017d45fdac6d1ef70
- origin/hotfix/audit-logger-fk-safe-fallback 681de891adc4fe1f81f5079bb5f78a16abbbdaf7
- origin/integration/vehicle-life-m1-m6 bf504c352e0a8e3ac000fe624692dcc90e75bb58
- origin/integration/vehicle-trust-os-product-activation 9102d2ac88ecf10bc69914d6cda41092df2610ee
- origin/main 08463d8ede9b54c39aace1e5b28a49fa87e0bdac
- origin/mimo/phase7c-verification-case-management 10b295018322e740e26a731c6e0d1a53789c6089
- origin/phase-7a-verification-hardening 7ec8b970128e2cdacad50c4ca3c67e64e2a96f85
- origin/phase-7b-verification-backend-ocr-persistence 53815137b04c4d6ee8a763f7e36f054542f991e5
- origin/phase-7c-native-verification-production-loop 4487eb1994d2edec8476e8faa5be9ce62252b14f
- origin/plan/vehicle-trust-full-activation 117b997a5a0b6da044b1718dada7a8eebbc19b38
- origin/release-closeout-docs a7a69e56820951c51a1cdda1cc766dcac088c550
- origin/release/carup-v1-rc1 fcc8a100b9e3b585edd38a86602e1fa7e77a5c94
- origin/release/core-vehicle-trust-os-mvp 6f0987661435177d9c7ab7bdaaf047847dcc5c4a
- origin/release/phase7c-verification-production 4839ee7f47227f93d46b7e858ddff38581c393b1
- origin/release/production 8c980544cddf00a6c6689ef6e7e9f6269bb3addb
- origin/security/cr1-credential-remediation b901949d947234733b88c40a13a4ec9547f53baa
- origin/security/production-access-containment ac1fdee31a59ba34ae125c1365f0d2f6de582238
- origin/test/referral-v1-stage5-import-container-acceptance bc9c4a5c626eb964912d67c9919cdba3721f31ca

## Tags
- rc/diaspora-9164500 7397d163d477c4ad41ba8846221f3442434b9ed8 -> 7397d16

## Open PRs (head SHAs)
- PR #122 security/cr1-credential-remediation @ b901949d947234733b88c40a13a4ec9547f53baa (base main)
- PR #121 docs/referral-v1-stage5-closure @ cb930115f2dcb776c5ee25b83ef6e5ff7644594d (base main)
- PR #105 feat/referral-wave-a-identity-attribution @ 163a46fc16a22c633537ed3f3067a2f8b59beeb2 (base main)

## Stashes (15)
- stash@{0} 2106f8eca49ad3f09d52e8110708632862e943ec On feature/agent-8-omnichannel-communication-engine: wip-communication-before-vehicle-trust
- stash@{1} b79f106945da9ada427f68120254b21931259689 On codex/navigation-intelligence-blueprint-completion: preserve-navigation-mobile-eslint-local
- stash@{2} 3d042c1835f7802aeb9ac096fc188e2dd339181e On phase-7c-native-verification-production-loop: phase-7c WIP: mobile verification result UI (preserved by referral-merge goal)
- stash@{3} 0efb7870e4471a003e48e344a4db1fcf65cb6292 On main: wip unrelated backend changes before phase 2a push
- stash@{4} 89d825255260ae14d71693e924d0ffee9fc230d7 On main: aborted navigation cleanup evidence flow test before phase 1d push
- stash@{5} 3678c628b3284776390c7c435c37e7a995e27fbe WIP on main: 87f62a9 feat: add diaspora workbook import review endpoints
- stash@{6} 12814defb21905e0ff12b353d3ff50398cdc6363 WIP on main: 87f62a9 feat: add diaspora workbook import review endpoints
- stash@{7} 3e21e1b6af9bc4b09e67c36d26c79651b597a0ca On main: aborted navigation cleanup evidence flow test
- stash@{8} fcc9236bae8a11290e62bb353eb1cd387ce7765d On main: aborted navigation cleanup dashboard guard
- stash@{9} 62213e5064b88dd97cd23cb6b77afebcc66cb980 On feature/navigation-intelligence-cleanup: aborted navigation cleanup tracked changes
- stash@{10} cc7beacebe4dd7ab0f8012741b8dbd1e906c72ea On main: wip before diaspora trade os pull
- stash@{11} 4737a83c7133343cf27c0e1c39cd4ec6f96f057f WIP on feature/premium-evidence-gallery: f581f43 feat(evidence): add premium evidence gallery
- stash@{12} eae35cc7632767c642fc3d47a78400f0c21ed9cf WIP on feature/marketplace-url-cleanup: 67a8025 Merge remote-tracking branch 'origin/main' into feature/marketplace-url-cleanup
- stash@{13} 0052fd395f7ee6ce6c6df5f5616471b028df6efe On main: diaspora-wip-preserved-cc42b41
- stash@{14} 17ddca9d70f1ca98e85774b69272f2155a818c65 On checkpoint/evidence-before-commit: wip audit logging and production stabilization

## Worktrees
- /Users/shadreckmusarurwa/Project AI/carup-kimi                             cb93011 [docs/referral-v1-stage5-closure]
- /private/var/folders/4d/t_g6qg9x59s_9b5wqd1sxj780000gn/T/lint-base-iCzW6n  d7ce28b (detached HEAD) prunable
- /Users/shadreckmusarurwa/Project AI/carup-cr1                              b901949 [security/cr1-credential-remediation]
- /Users/shadreckmusarurwa/Project AI/carup-diaspora-3-7                     bbcf421 [claude/diaspora-phases-3-7-program]
- /Users/shadreckmusarurwa/Project AI/carup-diaspora-8-10                    8510173 [claude/diaspora-phases-8-10-production-program]
- /Users/shadreckmusarurwa/Project AI/carup-hotfix-audit                     681de89 [hotfix/audit-logger-fk-safe-fallback]
- /Users/shadreckmusarurwa/Project AI/carup-int                              e0c94fd [integration/vehicle-life-m1-m6]
- /Users/shadreckmusarurwa/Project AI/carup-issue110                         f21808f [feature/agent-8-omnichannel-communication-engine]
- /Users/shadreckmusarurwa/Project AI/carup-m1                               6c885d0 [feat/vehicle-life-m1-taxonomy-provenance]
- /Users/shadreckmusarurwa/Project AI/carup-m2                               a174bef [feat/vehicle-life-m2-ingestion]
- /Users/shadreckmusarurwa/Project AI/carup-m3                               12a2bbc [feat/vehicle-life-m3-ai-temporal-disclosure]
- /Users/shadreckmusarurwa/Project AI/carup-m4                               0d5ac0c [feat/vehicle-life-m4-buyer-report]
- /Users/shadreckmusarurwa/Project AI/carup-m5                               ae23657 [feat/vehicle-life-m5-governance]
- /Users/shadreckmusarurwa/Project AI/carup-m6                               cf721ad [feat/vehicle-life-m6-infra-validation]
- /Users/shadreckmusarurwa/Project AI/carup-main-lint-baseline               c25b094 (detached HEAD)
- /Users/shadreckmusarurwa/Project AI/carup-navigation-release               8091f33 [nav-release-gate-fixes]
- /Users/shadreckmusarurwa/Project AI/carup-pa                               117b997 [plan/vehicle-trust-full-activation]
- /Users/shadreckmusarurwa/Project AI/carup-phase7c                          4487eb1 [phase-7c-native-verification-production-loop]
- /Users/shadreckmusarurwa/Project AI/carup-phase7c-release                  4839ee7 [release/phase7c-verification-production]
- /Users/shadreckmusarurwa/Project AI/carup-prod-migration-2e88f50           2e88f50 (detached HEAD)
- /Users/shadreckmusarurwa/Project AI/carup-referral-wt                      e7a2f60 [feat/referral-final-uat-release]
- /Users/shadreckmusarurwa/Project AI/carup-refv1-docs                       aa775a2 [docs/referral-v1-stage0-baseline]
- /Users/shadreckmusarurwa/Project AI/carup-refv1-fix                        dd50e85 [fix/referral-v1-stage4-journey-closure]
- /Users/shadreckmusarurwa/Project AI/carup-refv1-stage1                     6214f3d (detached HEAD)
- /Users/shadreckmusarurwa/Project AI/carup-security-containment             ac1fdee [security/production-access-containment]
- /Users/shadreckmusarurwa/Project AI/carup-vli-pr98                         bf504c3 [fix/pr98-ci-20260622]

## Execution outcomes (2026-07-26)
- Phase 2: PR #122 MERGED — merge commit fc11ee328e10 (pre-rewrite SHA), parents 08463d8 + b901949. Post-merge: scanner clean, guards 6/6, backend 762/755/0/7, tsc 0, build OK, main CI green.
- Phase 3/4: staging DB password reset attested 15:50 local (first attempt caught INEFFECTIVE by old-credential test; re-done). GitHub secret updated 2026-07-26T08:36:43Z. Both backends healthy on rotated config. No old-credential material remains locally.
- Phase 5: freeze manifest (74 branches + HEAD alias, 1 local tag, 2 open PRs, 15 stashes, preserved ref, 26 worktrees); backups: mirror 9.5M, carup-pre-cr1-all.bundle + preserved-stash.bundle (verified), 15 stash patches, CHECKSUMS.sha256 (23 artifacts).
- Phase 6: git-filter-repo v2.47.0 (pinned standalone) on a fresh mirror; regex replaced ONLY credential password components -> [ROTATED-SEE-CR1]; 901 commits processed; credential-URI occurrences 72 -> 0; prod project ref intentionally preserved (93 commits; owner scope correction); tip trees byte-identical for main + security branch; PR90-branch tip diff = exactly 3 credential files (±4 lines).
- Phase 7: 74/74 branches pushed with per-branch --force-with-lease against the frozen manifest (0 lease failures); rc/diaspora-9164500 re-created at rewritten RC commit da4ee3c5fe70 (annotated; old tag was local-only); ALL remote refs verified equal to the rewrite; new main 14cd98807063 (then 44dfccd/55fcb16 = canonical-UAT workflow + sslmode fix commits).
- Phase 8: local worktrees carup-cr1 + carup-diaspora-8-10 reconciled to rewritten refs; 15 stashes + refs/preserved/diaspora-wip-cc42b41 intact (old-history objects retained locally by design); FRESH CLONE from GitHub: full-history credential scan = 0, current-tree scanner clean (1484 files), guards 6/6, backend 762/755/0/7, migration sanity 1/1, tsc 0; auto-closed PRs #121/#105 re-created as #123/#124 from rewritten branches; old SHAs invalid — all collaborators/worktrees must re-clone or hard-reset (documented).
- Known incidents during sprint: (a) first rotation attempt ineffective — caught and redone; (b) rotated secret carries sslmode param that broke CI TLS (self-signed chain) — rotation scripts now strip sslmode; (c) UAT identity hashes changed by an unidentified DB-side action between 05:00-08:36Z — mitigated permanently by in-job rotation in the canonical UAT workflow (auth flow itself proven healthy via fresh register+login).

- Phase 4/9 FINAL: canonical UAT (Actions run 30196652910, in-job identity rotation via corrected secret) — 42 passed / 0 failed / 0 skipped / 0 flaky against the canonical aliases (bundle index-yYPmJ_bE.js). CR-1 CLOSED.
