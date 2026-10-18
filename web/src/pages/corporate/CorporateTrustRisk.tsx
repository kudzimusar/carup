/**
 * CA-OWNER-02 — Trust / Risk / Compliance (Business Operations plane; CA-UX-01 §16), read from the server's management read
 * model. Two layers: an aggregate layer (named queues, never one combined "trust %" or risk score) and the restricted operator
 * queues, reached explicitly. Aggregate access never implies access to identity documents, contact details, raw fraud evidence
 * or private dealer/garage documents.
 */
import { CorporatePage, OperateLinks, Section, StatementPanel } from '@/components/corporate/CorporatePage'
import { EnvironmentNote, ManagementStatus, QueueBoard } from '@/components/corporate/ManagementFacts'
import { OPERATE_LINKS } from '@/config/corporate/navigation'
import { useManagementArea } from '@/lib/corporate/useManagementArea'

export default function CorporateTrustRisk() {
  const { result, retry } = useManagementArea('trust')
  const data = result.status === 'ok' ? result.payload : null
  return (
    <CorporatePage id="trust-risk" intro="Risk and compliance work by named queue. Identity, evidence, dealer compliance, seller authority, PartSentry, fraud and trust remain separate facts.">
      <Section title="Aggregate workload" description="Each queue separately, from its own authority. No combined trust or risk percentage, and no score." testId="trust-aggregates">
        {data ? <QueueBoard queues={data.queues} regionLabel="Risk and compliance queues by measure" /> : <ManagementStatus result={result} onRetry={retry} />}
        {data && <EnvironmentNote environment={data.environment} generatedAt={data.generatedAt} />}
      </Section>
      <Section title="Restricted operator queues" testId="trust-operate">
        <StatementPanel>Seeing an aggregate here does not grant access to the records behind it. The operator queues below enforce their own authority on every request.</StatementPanel>
        <OperateLinks links={OPERATE_LINKS['trust-risk']} from="business_operations" title="Operate — review queues in Operational Admin" />
      </Section>
    </CorporatePage>
  )
}
