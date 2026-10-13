/**
 * CA-K3-01 — Platform landing (Platform & Security plane; CA-UX-01 §20). Technical governance only:
 * no revenue, customer growth, BU scorecards or compliance business decisions here, and no generic
 * business "health score". Platform authority does not imply Finance, People or identity access.
 */
import { CorporatePage, OperateLinks, Section, StatementPanel } from '@/components/corporate/CorporatePage'
import { MetricSlotView } from '@/components/corporate/TruthState'
import { OPERATE_LINKS } from '@/config/corporate/navigation'
import { NO_SOURCE } from './shared'

const AREAS = [
  { title: 'Runtime health & source availability', note: 'No governed platform reliability measure exists yet; none is estimated.' },
  { title: 'Integrations & providers', note: 'Provider connection state is administered on the existing technical surfaces.' },
  { title: 'Security', note: 'Server-side session revocation exists; Corporate security controls are a later slice.' },
  { title: 'Data pipeline & rollups', note: 'Rollup completeness will be reported as technical state, not business performance.' },
] as const

export default function CorporatePlatform() {
  return (
    <CorporatePage id="platform" intro="The technical platform: features, providers, AI/model operations, technical communications delivery, runtime and security. Nothing on this page is a measure of business performance.">
      <Section title="Technical attention" testId="platform-attention">
        <StatementPanel>No technical attention source is connected to Corporate Admin yet.</StatementPanel>
      </Section>
      <Section title="Platform areas" testId="platform-areas">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {AREAS.map((a) => (
            <MetricSlotView key={a.title} label={a.title} slot={NO_SOURCE} reason={a.note} size="sm" className="border-sky-100" />
          ))}
        </div>
      </Section>
      <OperateLinks links={OPERATE_LINKS.platform} from="platform_security" title="Administer — existing Platform & Security surfaces" />
    </CorporatePage>
  )
}
