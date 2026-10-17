/**
 * CA-K3-01 → CA-CLOSE-01 (F1) — People & Access (Business Operations plane; CA-UX-01 §18, CA-RBAC-01).
 *
 * Shows the AUTHORITATIVE persistent Corporate access record — the ACTIVE internal memberships and the ACTIVE persistent
 * permission assignments — from the server projection (GET /api/corporate/people-access), scoped by the trusted evaluator to
 * what the signed-in account governs. Read-only: no role editor, no mutation control, no invented title or permission, and
 * the legacy platform role is never presented as a permission.
 */
import { CorporatePage, OperateLinks, Section, StatementPanel } from '@/components/corporate/CorporatePage'
import { TruthStateBadge } from '@/components/corporate/TruthState'
import { OPERATE_LINKS } from '@/config/corporate/navigation'
import type { AssignmentRow, MembershipRow, OrgNodeRef, PersonRef } from '@/lib/corporate/peopleAccess'
import { useCorporateGrant, usePeopleAccessProjection } from '@/lib/corporate/usePeopleAccess'

const DISTINCTIONS: Array<{ title: string; question: string; today: string }> = [
  { title: 'Account', question: 'Who is the person or account principal?', today: 'Exists: CarUp accounts and sign-in. A governed account lifecycle (active, disabled, security hold, closed) is not built yet — account suspension is a known product gap.' },
  { title: 'Corporate membership', question: 'Where does the person belong inside CarUp?', today: 'Live: persistent internal Corporate memberships, each on one organisational node (shown below). Never inferred from tenant memberships or the legacy platform role.' },
  { title: 'Permission assignment', question: 'Which stable capabilities are assigned, and why?', today: 'Live for People governance: persistent assignments that were requested, independently approved and activated (shown below). Titles describe; assignments authorise. A requested or approved assignment grants nothing until active.' },
  { title: 'Organisational & geographic scope', question: 'Where may that permission be used?', today: 'Organisational scope is live on every assignment: a node, with or without its descendants. Geography is not modelled yet; it narrows, never widens, and is never inferred from residence or IP.' },
  { title: 'Delegation', question: 'Who acts for whom, for what, until when?', today: 'Future model. Always time-bound; never changes a title or a platform role.' },
  { title: 'External tenant membership', question: 'Which dealer, garage or institution relationships does the person hold?', today: 'Exists separately and stays separate: an external tenant role never becomes internal Corporate authority.' },
  { title: 'Session', question: 'Which sign-in sessions are valid, revoked or expired?', today: 'Exists: server-side session revocation. Revoking a session does not remove membership or permissions.' },
  { title: 'Audit', question: 'Who granted, used or revoked what, and when?', today: 'Every Corporate membership and assignment change is written to its own append-only Corporate ledger; domain audit continues per service.' },
]

/** Plain-language gloss of a stored capability — the stored identifier is always shown beside it. */
const CAPABILITY_GLOSS: Record<string, string> = {
  'corporate.people.membership.manage': 'Govern Corporate memberships',
  'corporate.people.session.revoke': 'Revoke Corporate sign-in sessions',
}
const FLOOR_GLOSS: Record<string, string> = {
  A1_RECENT_REAUTH: 'A1 — recent password re-authentication',
  A2_STRONG: 'A2 — strong authenticator',
}

const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : null)
const period = (from: string, until: string | null) => `${day(from)} → ${until ? day(until) : 'no end date'}`
const nodeLabel = (n: OrgNodeRef) => (n.displayName ? `${n.displayName} (${n.nodeId})` : n.nodeId)

function Person({ person }: { person: PersonRef | null }) {
  if (!person) return <span className="text-slate-400">—</span>
  return (
    <span>
      <span className="font-medium text-slate-900">{person.name ?? person.email ?? person.userId}</span>
      {person.email && person.name && <span className="block text-xs text-slate-500">{person.email}</span>}
    </span>
  )
}

function MembershipsTable({ rows }: { rows: MembershipRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="min-w-full text-left text-sm" data-testid="people-memberships-table">
        <caption className="sr-only">Active Corporate memberships</caption>
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr><th scope="col" className="px-3 py-2">Person</th><th scope="col" className="px-3 py-2">Organisation node</th><th scope="col" className="px-3 py-2">State</th><th scope="col" className="px-3 py-2">Effective</th><th scope="col" className="px-3 py-2">Recorded by</th></tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.membershipId} className="border-b border-slate-100 align-top last:border-0" data-testid="people-membership-row" data-membership-id={m.membershipId}>
              <td className="px-3 py-2"><Person person={m.subject} /></td>
              <td className="px-3 py-2 text-slate-700">{nodeLabel(m.orgNode)}</td>
              <td className="px-3 py-2"><span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-800" data-testid="people-membership-state">{m.state}</span></td>
              <td className="px-3 py-2 text-slate-700" data-testid="people-membership-period">{period(m.effectiveFrom, m.effectiveUntil)}</td>
              <td className="px-3 py-2 text-slate-700"><Person person={m.createdBy} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AssignmentsTable({ rows }: { rows: AssignmentRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="min-w-full text-left text-sm" data-testid="people-assignments-table">
        <caption className="sr-only">Active persistent Corporate permission assignments</caption>
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr><th scope="col" className="px-3 py-2">Person</th><th scope="col" className="px-3 py-2">Capability</th><th scope="col" className="px-3 py-2">Scope</th><th scope="col" className="px-3 py-2">Assurance floor</th><th scope="col" className="px-3 py-2">Effective</th><th scope="col" className="px-3 py-2">Approved / activated by</th></tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.assignmentId} className="border-b border-slate-100 align-top last:border-0" data-testid="people-assignment-row" data-assignment-id={a.assignmentId}>
              <td className="px-3 py-2"><Person person={a.subject} /></td>
              <td className="px-3 py-2">
                <span className="block text-slate-900">{CAPABILITY_GLOSS[a.capability] ?? a.capability}</span>
                <code className="text-xs text-slate-500" data-testid="people-assignment-capability">{a.capability}</code>
              </td>
              <td className="px-3 py-2 text-slate-700" data-testid="people-assignment-scope">
                {a.scope.map(nodeLabel).join(', ')}
                <span className="block text-xs text-slate-500">{a.includeDescendants ? 'and every node below it' : 'this node only'}</span>
              </td>
              <td className="px-3 py-2 text-slate-700" data-testid="people-assignment-floor">{FLOOR_GLOSS[a.assuranceFloor] ?? a.assuranceFloor}</td>
              <td className="px-3 py-2 text-slate-700" data-testid="people-assignment-period">
                {period(a.effectiveFrom, a.effectiveUntil)}
                <span className="block text-xs text-slate-500">{a.state}{a.effectiveNow ? ' · in force now' : ' · not in force now'}</span>
              </td>
              <td className="px-3 py-2 text-slate-700"><Person person={a.approvedBy} />{a.activatedBy && a.activatedBy.userId !== a.approvedBy?.userId && <span className="mt-1 block"><Person person={a.activatedBy} /></span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CorporatePeopleAccess() {
  const result = usePeopleAccessProjection()
  const grant = useCorporateGrant()

  return (
    <CorporatePage id="people-access" intro="Who has what authority, where, why and until when. Each of these is a separate fact with its own lifecycle and its own action.">
      <Section
        title="Corporate access record"
        testId="people-access-record"
        description="Read from the persistent Corporate membership and permission tables, limited to the organisation nodes your own membership-management authority covers. Changes go through the governed request, independent approval and execution path — never from this page."
      >
        {result.status === 'pending' && (
          <p className="text-sm text-slate-600" data-testid="people-access-loading" role="status">Loading the Corporate access record…</p>
        )}
        {result.status === 'denied' && (
          <StatementPanel tone="blocked" testId="people-access-denied">
            <TruthStateBadge state="FORBIDDEN" />
            <span className="ml-2">Viewing Corporate memberships requires a persistent membership-management assignment. Nothing is shown.</span>
          </StatementPanel>
        )}
        {(result.status === 'unavailable' || result.status === 'unauthenticated') && (
          <StatementPanel tone="blocked" testId="people-access-unavailable">
            <TruthStateBadge state="UNAVAILABLE_NO_SOURCE" />
            <span className="ml-2">The Corporate access record could not be read right now. Nothing is shown rather than something unconfirmed.</span>
          </StatementPanel>
        )}
        {result.status === 'ok' && (
          <div className="space-y-5" data-testid="people-access-projection">
            <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <TruthStateBadge state="GOVERNED_ACTUAL" />
              <span>Governed nodes: {result.projection.governedNodes.map(nodeLabel).join(', ')}</span>
              <span>· as of {new Date(result.projection.generatedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC</span>
            </p>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Active Corporate memberships <span className="text-slate-500" data-testid="people-membership-count">({result.projection.memberships.length})</span>
              </h3>
              {result.projection.memberships.length > 0 ? <MembershipsTable rows={result.projection.memberships} /> : <p className="text-sm text-slate-600">No active membership in the nodes you govern.</p>}
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Active permission assignments <span className="text-slate-500" data-testid="people-assignment-count">({result.projection.assignments.length})</span>
              </h3>
              {result.projection.assignments.length > 0 ? <AssignmentsTable rows={result.projection.assignments} /> : <p className="text-sm text-slate-600">No active assignment on those memberships.</p>}
            </div>
          </div>
        )}
      </Section>

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
          {grant ? grant.explanation : 'Your access is decided by the server for this session.'}
        </StatementPanel>
      </Section>

      {grant?.compatibility && (
        <OperateLinks links={OPERATE_LINKS['people-access']} from="business_operations" title="Operate — compatibility surface" />
      )}
    </CorporatePage>
  )
}
