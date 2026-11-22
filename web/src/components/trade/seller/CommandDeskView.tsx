/**
 * RX-06 Trade — the command desk (unified /diaspora/ai-commands): propose → review → apply.
 *
 *   1 Propose — type what you want done; "Preview" parses without saving, "Save as proposal" records it.
 *   2 Review  — the parser's reading, verbatim: intent, risk, confidence, what it found and what is missing.
 *   3 Apply   — only through the existing action the server allows for that proposal (confirm, apply,
 *               reviewer approval), or discard it. High-risk proposals are never executed here.
 *
 * A proposal is never presented as an action taken. Fed by DiasporaAiCommandCenter's own state and
 * handlers; the catalogue (commandDesk.ts) explains every command type the backend supports.
 */
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Bot, Check, Lock, ShieldAlert, Sparkles, Trash2 } from 'lucide-react'
import type { DiasporaAiCommand, DiasporaAiParseResult } from '@/types'
import { StatusChip } from '@/components/dealer/workspace/StatusChip'
import { DeskHeader, DeskNotice, DeskPanel, DeskPulse, DeskSegments, DeskState, Provenance, ReadFailureState } from './DeskPrimitives'
import { DESK_DANGER, DESK_EYEBROW, DESK_FIELD, DESK_HINT, DESK_INK_SECONDARY, DESK_PANEL, DESK_PRIMARY, DESK_SECONDARY, DESK_TEXT_ACTION } from './deskStyles'
import { humanize, shortRef, when } from './deskFormat'
import {
  COMMAND_CATALOGUE, EXECUTION_LABEL, appliedResult, canDiscard, confidenceText, entityLabel, executionTone, offeredAction, riskTone, specOf,
  type CommandDeskModel, type CommandSpec,
} from './commandDesk'

const PAGE = 'mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8'
type Filter = 'all' | 'you' | 'reviewer' | 'done'
const YOU = new Set(['DRAFT', 'AWAITING_CONFIRMATION', 'CONFIRMED'])
const REVIEWER = new Set(['AWAITING_APPROVAL', 'NEEDS_REVIEW'])
const inFilter = (cmd: DiasporaAiCommand, f: Filter) => {
  const s = String(cmd.execution_status || '').toUpperCase()
  if (f === 'you') return YOU.has(s)
  if (f === 'reviewer') return REVIEWER.has(s)
  if (f === 'done') return !YOU.has(s) && !REVIEWER.has(s)
  return true
}

export function CommandDeskView({ model }: { model: CommandDeskModel }) {
  const [filter, setFilter] = useState<Filter>('all')

  if (model.authLoading) {
    return <div className={PAGE}><DeskState kind="loading" title="Opening the command desk…" testId="trade-ai-loading" /></div>
  }
  if (!model.isAuthenticated) {
    return (
      <div className={PAGE}>
        <DeskState kind="signin" title="Sign in to use the command desk" testId="trade-ai-signin" action={<Link to="/login" className={DESK_PRIMARY}>Sign in</Link>}>
          Commands are proposals made by a signed-in trade account.
        </DeskState>
      </div>
    )
  }
  if (!model.canView) {
    return (
      <div className={PAGE}>
        <DeskState kind="denied" title="The command desk is for trade roles" testId="trade-ai-denied">
          This account is signed in as <strong className="text-carup-text">{humanize(model.role, 'an unrecognised role')}</strong>. Commands can be proposed by owners, dealers and CarUp reviewers or administrators.
        </DeskState>
      </div>
    )
  }

  const cmds = model.commands
  const count = (f: Filter) => cmds.filter((c) => inFilter(c, f)).length
  const listUnread = Boolean(model.commandsFailure) && cmds.length === 0
  const shown = cmds.filter((c) => inFilter(c, filter))
  const actionError = model.error && model.error !== model.commandsFailure?.message ? model.error : ''

  return (
    <div className={PAGE} data-testid="trade-ai-desk">
      <DeskHeader
        testId="trade-ai-header"
        eyebrow="Trade · Command desk"
        title="AI command center"
        description="Say what you want done. CarUp's command parser turns it into a proposal; nothing happens until you review it and apply it through the existing action. High-risk commands are never executed here."
        actions={<Link to="/diaspora/rfq" className={DESK_INK_SECONDARY}>Reverse RFQ</Link>}
        pulse={(
          <DeskPulse testId="trade-ai-pulse" scope={listUnread ? 'Proposals not loaded' : 'In this read'}
            items={listUnread ? [] : [
              { label: cmds.length === 1 ? 'proposal' : 'proposals', value: cmds.length, testId: 'trade-ai-pulse-total' },
              { label: 'waiting on you', value: count('you') },
              { label: 'with a reviewer', value: count('reviewer') },
              { label: 'closed', value: count('done') },
            ]} />
        )}
      />

      <ol className="mt-6 grid grid-cols-3 gap-2" aria-label="How a command works" data-testid="trade-ai-flow">
        {([
          ['1', 'Propose', 'Type it. Preview reads it without saving anything.'],
          ['2', 'Review', 'Check what the parser understood — it can be wrong.'],
          ['3', 'Apply', 'Only through the action CarUp allows for that proposal.'],
        ] as const).map(([n, title, body]) => (
          <li key={n} className={`${DESK_PANEL} flex min-w-0 items-center gap-2 p-2.5 sm:items-start sm:gap-3 sm:p-3`}>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-carup-raw-ink font-mono text-xs font-semibold text-white" aria-hidden="true">{n}</span>
            <span className="min-w-0"><span className="block text-sm font-semibold text-carup-text">{title}</span><span className="hidden text-xs leading-5 text-carup-text-2 sm:block">{body}</span></span>
          </li>
        ))}
      </ol>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Composer model={model} />
          {model.parsed && <ParsePreview parsed={model.parsed} />}
        </div>
        <section aria-label="Proposals" className="min-w-0 space-y-3" data-testid="trade-ai-queue">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-carup-text">Proposals</h2>
            <button type="button" className={DESK_TEXT_ACTION} onClick={model.onRetryCommands} data-testid="trade-ai-refresh">Refresh</button>
          </div>
          {!listUnread && cmds.length > 0 && (
            <DeskSegments label="Filter proposals" testId="trade-ai-filter" active={filter} onChange={setFilter} items={[
              { id: 'all', label: 'All', count: cmds.length },
              { id: 'you', label: 'Waiting on you', count: count('you') },
              { id: 'reviewer', label: 'With a reviewer', count: count('reviewer') },
              { id: 'done', label: 'Closed', count: count('done') },
            ]} />
          )}
          {model.lastSubmit?.duplicate && (
            <DeskNotice tone="warning" testId="trade-ai-duplicate">
              You already proposed exactly this. CarUp kept the existing proposal instead of saving a second one.
            </DeskNotice>
          )}
          {actionError && <DeskNotice tone="danger" testId="trade-ai-error">{actionError}</DeskNotice>}
          {model.commandsFailure && cmds.length > 0 && (
            <DeskNotice tone="warning" testId="trade-ai-list-stale">
              This list may be out of date: the latest refresh failed ({model.commandsFailure.message}). Statuses below are from the last successful read.{' '}
              <button type="button" className={DESK_TEXT_ACTION} onClick={model.onRetryCommands} data-testid="trade-ai-list-stale-retry">Refresh again</button>
            </DeskNotice>
          )}
          {listUnread && model.commandsFailure ? (
            <ReadFailureState failure={model.commandsFailure} what="Your proposals" onRetry={model.onRetryCommands} testId="trade-ai-list-failed" />
          ) : !model.commandsLoaded && cmds.length === 0 ? (
            <DeskState kind="loading" compact title="Loading your proposals…" testId="trade-ai-list-loading" />
          ) : cmds.length === 0 ? (
            <DeskState kind="empty" title="No proposals yet" testId="trade-ai-empty">
              Type what you want done in the composer. CarUp turns it into a proposal you review before anything happens — and nothing is done until you apply it.
            </DeskState>
          ) : shown.length === 0 ? (
            <p className="rounded-card border border-dashed border-carup-line-strong p-4 text-sm text-carup-text-2" data-testid="trade-ai-filter-empty">Nothing in this filter.</p>
          ) : (
            <ul className="space-y-3" data-testid="trade-ai-list">
              {shown.map((cmd) => <ProposalCard key={cmd.id} cmd={cmd} model={model} />)}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-6">
        <Catalogue onUse={(phrase) => model.setText(phrase)} />
      </div>
    </div>
  )
}

function Composer({ model }: { model: CommandDeskModel }) {
  const ids = useId()
  return (
    <DeskPanel testId="trade-ai-composer" eyebrow="1 · Propose" title="What do you want done?"
      provenance={<span className="text-xs text-carup-text-3" data-testid="trade-ai-voice">Voice input: {model.voiceAvailable ? 'available' : 'not available — text only for now'}</span>}>
      <label htmlFor={`${ids}-text`} className="sr-only">Command</label>
      <textarea id={`${ids}-text`} value={model.text} onChange={(e) => model.setText(e.target.value)} rows={4}
        placeholder="e.g. reserve stock stk-1 5 units" className={`${DESK_FIELD} min-h-28 resize-y leading-6`} data-testid="trade-ai-input" />
      <p className={DESK_HINT}>Mention a reference like <span className="font-mono">stk-1</span> or a full id, and a quantity, when the command needs them.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={DESK_SECONDARY} onClick={model.onParse} data-testid="trade-ai-parse">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> Preview (saves nothing)
        </button>
        <button type="button" className={DESK_PRIMARY} onClick={model.onSubmit} disabled={model.busy} data-testid="trade-ai-submit">
          {model.busy ? 'Saving…' : 'Save as proposal'}
        </button>
      </div>
      <p className="mt-3 text-xs leading-5 text-carup-text-3">Saving records a proposal only. Applying is a separate, explicit step on the proposal.</p>
    </DeskPanel>
  )
}

function ParsePreview({ parsed }: { parsed: DiasporaAiParseResult }) {
  const spec = specOf(parsed.intent)
  const conf = confidenceText(parsed.confidence)
  const entities = Object.entries(parsed.entities ?? {})
  return (
    <section aria-label="Proposal preview" className={`${DESK_PANEL} p-4 sm:p-5`} data-testid="trade-ai-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={DESK_EYEBROW}>2 · Review — preview, not saved</p>
        <Provenance kind="automated" label="Read by the command parser · not verified" />
      </div>
      <p className="mt-2 text-base font-semibold text-carup-text">{spec?.label ?? (parsed.intent ? humanize(parsed.intent) : 'No command recognised')}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {parsed.intent && <span className="rounded-full bg-carup-bg-surface px-2 py-0.5 font-mono text-[11px] text-carup-text-2">{parsed.intent}</span>}
        <StatusChip tone={riskTone(parsed.risk)} testId="trade-ai-preview-risk">{parsed.risk ? `${humanize(parsed.risk)} risk` : 'Risk not assessed'}</StatusChip>
        <StatusChip tone="neutral" testId="trade-ai-preview-confidence">Confidence {conf ?? 'not reported'}</StatusChip>
        {parsed.ambiguous && <StatusChip tone="warning" testId="trade-ai-preview-ambiguous">Ambiguous</StatusChip>}
      </div>
      {entities.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm" data-testid="trade-ai-preview-entities">
          {entities.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-1.5"><dt className="text-xs text-carup-text-3">{entityLabel(k)}</dt><dd className="font-mono text-[12.5px] text-carup-text">{String(v)}</dd></div>
          ))}
        </dl>
      )}
      {(parsed.missing?.length ?? 0) > 0 && <p className="mt-2 text-sm font-semibold text-status-warning" data-testid="trade-ai-preview-missing">Missing: {parsed.missing!.map((m) => entityLabel(m)).join(', ')}</p>}
      {(parsed.reasons?.length ?? 0) > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs leading-5 text-carup-text-2" data-testid="trade-ai-preview-reasons">
          {parsed.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      {spec && <p className="mt-3 rounded-control bg-carup-bg-surface px-3 py-2 text-sm leading-6 text-carup-text-2"><strong className="text-carup-text">If saved and applied:</strong> {spec.does}</p>}
      {parsed.risk === 'HIGH' && (
        <p className="mt-2 flex items-start gap-1.5 text-sm font-semibold text-status-danger" data-testid="trade-ai-preview-blocked">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> High risk: a reviewer must approve it, and it still stays blocked from execution.
        </p>
      )}
      <p className="mt-3 text-xs text-carup-text-3">Nothing has been saved or done.</p>
    </section>
  )
}

function ProposalCard({ cmd, model }: { cmd: DiasporaAiCommand; model: CommandDeskModel }) {
  const [discarding, setDiscarding] = useState(false)
  const spec = specOf(cmd.intent)
  const offered = offeredAction(cmd, model.isReviewer)
  const discardable = canDiscard(cmd, model.viewerId, model.isReviewer)
  const result = String(cmd.execution_status).toUpperCase() === 'EXECUTED' ? appliedResult(cmd) : null
  const busy = model.actingId === cmd.id
  const conf = confidenceText(cmd.confidence_score)
  const entities = Object.entries(cmd.extracted_entities ?? {})
  const meta = (cmd.metadata ?? {}) as Record<string, unknown>
  const reasons = Array.isArray(meta.reasons) ? (meta.reasons as unknown[]).map(String) : []
  const refusedHere = offered === 'execute' && spec?.apply === 'refused'
  return (
    <li className={`${DESK_PANEL} p-4 sm:p-5`} data-testid={`trade-ai-proposal-${cmd.id}`} data-status={cmd.execution_status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold text-carup-text">{spec?.label ?? humanize(cmd.intent, 'Unrecognised command')}</p>
          <p className="mt-0.5 text-sm text-carup-text-2 [overflow-wrap:anywhere]">“{cmd.raw_command}”</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusChip tone={executionTone(cmd.execution_status)} testId="trade-ai-status">{EXECUTION_LABEL[String(cmd.execution_status).toUpperCase()] ?? humanize(cmd.execution_status)}</StatusChip>
          <StatusChip tone={riskTone(cmd.risk_level)}>{humanize(cmd.risk_level, 'Unknown')} risk</StatusChip>
        </div>
      </div>
      <p className="mt-2 text-[12px] text-carup-text-3">
        Proposed {when(cmd.created_at ?? null) ?? '(time not recorded)'} · confidence {conf ?? 'not reported'} · <span className="font-mono">{shortRef(cmd.id)}</span>
        {cmd.approval_status && cmd.approval_status !== 'NOT_REQUIRED' ? ` · reviewer approval: ${humanize(cmd.approval_status)}` : ''}
      </p>
      {entities.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {entities.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-1.5"><dt className="text-xs text-carup-text-3">{entityLabel(k)}</dt><dd className="font-mono text-[12.5px] text-carup-text [overflow-wrap:anywhere]">{String(v)}</dd></div>
          ))}
        </dl>
      )}
      {reasons.length > 0 && <p className="mt-2 text-xs leading-5 text-carup-text-2">Parser: {reasons.join(' · ')}</p>}
      {spec && !result && String(cmd.execution_status).toUpperCase() !== 'REJECTED' && (
        <p className="mt-2 text-sm leading-6 text-carup-text-2"><strong className="text-carup-text">Applying:</strong> {spec.does}</p>
      )}

      {result && (
        <div className="mt-3 rounded-control border border-status-info bg-status-info-soft px-3 py-2 text-sm text-carup-text" data-testid="trade-ai-result">
          <Check className="mr-1 inline h-4 w-4 text-status-info" aria-hidden="true" />{result.text}
          {cmd.executed_at && <span className="text-carup-text-2"> Applied {when(cmd.executed_at) ?? ''}.</span>}
          {result.link && <> <Link to={result.link.to} className="font-semibold text-carup-action underline-offset-4 hover:underline">{result.link.label}</Link></>}
        </div>
      )}
      {String(cmd.execution_status).toUpperCase() === 'FAILED' && (
        <p className="mt-3 rounded-control border border-status-danger bg-status-danger-soft px-3 py-2 text-sm text-carup-text" data-testid="trade-ai-failed">
          Applying failed{cmd.error_message ? `: ${cmd.error_message}` : '.'} Nothing was created.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-carup-line pt-3">
        {offered === 'confirm' && (
          <button type="button" className={DESK_PRIMARY} disabled={busy} onClick={() => model.onConfirm(cmd.id)} data-testid="trade-ai-confirm">
            {busy ? 'Confirming…' : 'Confirm this proposal'}
          </button>
        )}
        {offered === 'execute' && !refusedHere && (
          <button type="button" className={DESK_PRIMARY} disabled={busy} onClick={() => model.onExecute(cmd.id)} data-testid="trade-ai-execute">
            {busy ? 'Applying…' : applyLabel(spec)}
          </button>
        )}
        {refusedHere && (
          <span className="text-sm text-carup-text-2" data-testid="trade-ai-refused-here">
            The command service refuses to apply this type.{spec?.via && <> Do it in <Link to={spec.via.to} className="font-semibold text-carup-action underline-offset-4 hover:underline">{spec.via.label}</Link>.</>}
          </span>
        )}
        {offered === 'approve' && (
          <button type="button" className={DESK_SECONDARY} disabled={busy} onClick={() => model.onApprove(cmd.id)} data-testid="trade-ai-approve">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" /> {busy ? 'Approving…' : 'Approve (stays blocked)'}
          </button>
        )}
        {cmd.risk_level === 'HIGH' && (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-status-danger" data-testid="trade-ai-blocked-note"><Lock className="h-4 w-4" aria-hidden="true" /> Execution blocked</span>
        )}
        {String(cmd.execution_status).toUpperCase() === 'NEEDS_REVIEW' && (
          <span className="text-sm text-carup-text-2" data-testid="trade-ai-needs-review">The parser was unsure, so this cannot be applied. Rephrase it and save a new proposal.</span>
        )}
        {discardable && !discarding && (
          <button type="button" className={`${DESK_TEXT_ACTION} ml-auto`} onClick={() => setDiscarding(true)} data-testid="trade-ai-discard">
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Discard
          </button>
        )}
      </div>
      {discarding && (
        <div className="mt-3 rounded-control bg-carup-bg-surface p-3" data-testid="trade-ai-discard-confirm">
          <p className="text-sm text-carup-text">Discard this proposal? It is marked rejected and can never be applied.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={DESK_DANGER} disabled={busy} onClick={() => { model.onDiscard(cmd.id); setDiscarding(false) }} data-testid="trade-ai-discard-yes">Discard proposal</button>
            <button type="button" className={DESK_SECONDARY} onClick={() => setDiscarding(false)}>Keep it</button>
          </div>
        </div>
      )}
    </li>
  )
}

function applyLabel(spec: CommandSpec | null): string {
  if (!spec) return 'Apply'
  if (spec.apply === 'draft') return 'Apply — create the draft'
  if (spec.apply === 'ledger') return 'Apply — reserve through the ledger'
  if (spec.apply === 'record-only') return 'Apply — mark as applied'
  return 'Apply'
}

function Catalogue({ onUse }: { onUse: (phrase: string) => void }) {
  const groups = [
    { risk: 'LOW', title: 'Low risk — applying creates drafts only' },
    { risk: 'MEDIUM', title: 'Medium risk — you confirm first' },
    { risk: 'HIGH', title: 'High risk — never executed here' },
  ] as const
  return (
    <DeskPanel testId="trade-ai-catalogue" eyebrow="Every command CarUp understands" title={<span className="inline-flex items-center gap-2"><Bot className="h-4 w-4 text-carup-text-3" aria-hidden="true" />What you can ask</span>}
      description="AI cannot release payment, approve compliance, verify documents, complete shipments or override the stock ledger.">
      <div className="grid gap-x-8 gap-y-5 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.risk} className="min-w-0">
            <p className="text-xs font-semibold text-carup-text">{g.title}</p>
            <ul className="mt-1.5 divide-y divide-carup-line">
              {COMMAND_CATALOGUE.filter((c) => c.risk === g.risk).map((c) => (
                <li key={c.intent} className="py-2" data-testid={`trade-ai-catalogue-${c.intent}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 text-sm font-semibold text-carup-text">{c.label}</p>
                    {c.risk !== 'HIGH' && (
                      <button type="button" className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-control px-2 text-xs font-semibold text-carup-action hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus"
                        onClick={() => onUse(c.example)} aria-label={`Use the example: ${c.example}`}>
                        Use example <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs leading-5 text-carup-text-2">{c.does}</p>
                  {c.risk !== 'HIGH' && <p className="mt-0.5 font-mono text-[11.5px] text-carup-text-3">“{c.example}”</p>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </DeskPanel>
  )
}
