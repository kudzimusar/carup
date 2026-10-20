/**
 * CA-OWNER-02 — Operations (Business Operations plane; CA-UX-01 §15), read from the server's management read model.
 *
 * Named queues only — no overall operations health score. Each queue states what is waiting, since when, the rule that decides
 * whether it needs attention, its owner and source, and opens its existing operational surface; Corporate Admin creates no
 * generic mutation authority and copies no decision control here. A queue that could not be read says so — it is never empty.
 */
import { CorporatePage, OperateLinks, Section } from '@/components/corporate/CorporatePage'
import { EnvironmentNote, FactRows, ManagementStatus, QueueBoard } from '@/components/corporate/ManagementFacts'
import { OPERATE_LINKS } from '@/config/corporate/navigation'
import { useManagementArea } from '@/lib/corporate/useManagementArea'

export default function CorporateOperations() {
  const { result, retry, revalidating } = useManagementArea('operations')
  const data = result.status === 'ok' ? result.payload : null
  return (
    <CorporatePage id="operations" intro="Cross-business-unit operating view over the workflows each unit owns. Every queue is shown on its own, never summed into one number.">
      <Section title="Named queues" description="What is waiting for CarUp now, since when, and the rule that decides whether it needs attention. A read failure is reported as such — it is never an empty queue." testId="operations-queues">
        {/* CA-K3-01-R3 D-4: on wider screens the queue table is a focusable, labelled scroll region; at phone width each
            queue is a card instead, so nothing scrolls sideways. */}
        {data ? <QueueBoard queues={data.queues} regionLabel="Operational queues by domain and measure" /> : <ManagementStatus result={result} onRetry={retry} />}
      </Section>
      {data && (
        <>
          <Section title="Customer conversations" description="Operational conversations only: certification, UAT, automation and historical conversations are counted separately and never as customer work. Reply targets name where they come from." testId="operations-communications">
            <FactRows facts={data.communications} caption="Customer conversations" />
          </Section>
          <EnvironmentNote environment={data.environment} generatedAt={data.generatedAt} snapshot={data.snapshot} revalidating={revalidating} />
        </>
      )}
      <Section title="Work the queues" description="Decisions are made on the existing operational surfaces, which remain the authority for every action." testId="operations-operate">
        <OperateLinks links={OPERATE_LINKS.operations} from="business_operations" title="Operate — queues in Operational Admin" />
      </Section>
    </CorporatePage>
  )
}
