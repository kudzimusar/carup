/**
 * CA-K3-01 — People & Access landing (Business Operations plane; CA-UX-01 §18, CA-RBAC-01). Prepares
 * the distinctions the future access model keeps separate. Implements no membership schema and no
 * role editor; the legacy platform role field is never presented as "permissions".
 */
import { CorporatePage, OperateLinks, Section, StatementPanel } from '@/components/corporate/CorporatePage'
import { OPERATE_LINKS } from '@/config/corporate/navigation'

const DISTINCTIONS: Array<{ title: string; question: string; today: string }> = [
  { title: 'Account', question: 'Who is the person or account principal?', today: 'Exists: CarUp accounts and sign-in. A governed account lifecycle (active, disabled, security hold, closed) is not built yet — account suspension is a known product gap.' },
  { title: 'Corporate membership', question: 'Where does the person belong inside CarUp?', today: 'Future model (CA-ORG / CA-RBAC). Not inferred from tenant memberships or the legacy platform role.' },
  { title: 'Permission assignment', question: 'Which stable capabilities are assigned, and why?', today: 'Future model. Titles describe; assignments authorise. A requested or approved assignment grants nothing until active.' },
  { title: 'Organisational & geographic scope', question: 'Where may that permission be used?', today: 'Future model. Geography narrows; it never widens, and it is never inferred from residence or IP.' },
  { title: 'Delegation', question: 'Who acts for whom, for what, until when?', today: 'Future model. Always time-bound; never changes a title or a platform role.' },
  { title: 'External tenant membership', question: 'Which dealer, garage or institution relationships does the person hold?', today: 'Exists separately and stays separate: an external tenant role never becomes internal Corporate authority.' },
  { title: 'Session', question: 'Which sign-in sessions are valid, revoked or expired?', today: 'Exists: server-side session revocation. Revoking a session does not remove membership or permissions.' },
  { title: 'Audit', question: 'Who granted, used or revoked what, and when?', today: 'Domain audit exists per service; a Corporate access audit is a future addition that complements, not replaces, it.' },
]

export default function CorporatePeopleAccess() {
  return (
    <CorporatePage id="people-access" intro="Who has what authority, where, why and until when. Each of these is a separate fact with its own lifecycle and its own action.">
      <Section title="Separate facts, separate lifecycles" testId="people-distinctions">
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="people-distinction-list">
          {DISTINCTIONS.map((d) => (
            <li key={d.title} className="rounded-md border border-slate-200 bg-white p-4" data-testid="people-distinction">
              <h3 className="text-sm font-semibold text-slate-900">{d.title}</h3>
              <p className="mt-0.5 text-xs text-slate-600">{d.question}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">{d.today}</p>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Your current access" testId="people-current-access">
        <StatementPanel>
          You are here through the <span className="font-medium">legacy Admin compatibility bridge</span>: the platform administrator check that gates the current operational Admin.
          It is not a Corporate membership or a permission assignment, and it opens read-only navigation only. Every request is still authorised by the server.
        </StatementPanel>
      </Section>
      <OperateLinks links={OPERATE_LINKS['people-access']} from="business_operations" title="Operate — compatibility surface" />
    </CorporatePage>
  )
}
