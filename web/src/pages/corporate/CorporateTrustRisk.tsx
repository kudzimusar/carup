/**
 * CA-K3-01 — Trust / Risk / Compliance landing (Business Operations plane; CA-UX-01 §16). Two layers:
 * an aggregate layer (named queues, never one combined "trust %") and the restricted operator queues,
 * reached explicitly. Aggregate access never implies access to identity documents, contact details,
 * raw fraud evidence or private dealer/garage documents.
 */
import { CorporatePage, OperateLinks, Section, StatementPanel } from '@/components/corporate/CorporatePage'
import { CompactSlotList } from '@/components/corporate/TruthState'
import { OPERATE_LINKS } from '@/config/corporate/navigation'
import { K2B_PENDING_REASON, PENDING_K2B } from './shared'

const AGGREGATES = ['Verification backlog', 'Evidence backlog', 'Fraud cases (open and investigating)', 'Governance review', 'Dealer compliance', 'Garage review'] as const

export default function CorporateTrustRisk() {
  return (
    <CorporatePage id="trust-risk" intro="Risk and compliance work by named queue. Identity, evidence, dealer compliance, seller authority, PartSentry, fraud and trust remain separate facts.">
      <Section title="Aggregate workload" description="Each queue separately. No combined trust or risk percentage." testId="trust-aggregates">
        <CompactSlotList caption="Risk and compliance workload by named queue" items={AGGREGATES.map((a) => ({ label: a, slot: PENDING_K2B }))} />
        <p className="text-xs text-slate-500">{K2B_PENDING_REASON}</p>
      </Section>
      <Section title="Restricted operator queues" testId="trust-operate">
        <StatementPanel>Seeing an aggregate here does not grant access to the records behind it. The operator queues below enforce their own authority on every request.</StatementPanel>
        <OperateLinks links={OPERATE_LINKS['trust-risk']} from="business_operations" title="Operate — review queues on the current operational Admin" />
      </Section>
    </CorporatePage>
  )
}
