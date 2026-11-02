import type { OwnerServiceHistoryEntry } from '@shared/types';

/**
 * OC-5D (P6) — how the native Garage shows one service-history entry
 * (shared/contracts/owner-service-history.v1.contract.json).
 *
 * The screen used to read `item.cost` — a key the endpoint never returned — and threw on the first
 * non-empty history (F1). It also filled gaps with claims: a missing status read "Verified", missing
 * parts read "General Maintenance", and every amount was printed in dollars. Here a missing fact is
 * said to be missing, and money is shown with its currency or not at all.
 */
export interface ServiceLogView {
  key: string;
  vinLabel: string;
  title: string;
  dateLabel: string;
  costLabel: string;
  costRecorded: boolean;
  detail: { label: string; value: string } | null;
  statusLabel: string;
  authorizationLabel: string | null;
}

const AUTHORIZATION_LABELS: Record<string, string> = {
  pending: 'Awaiting owner authorization',
  authorized: 'Authorized by the owner',
  declined: 'Declined by the owner',
  revoked: 'Owner authorization revoked',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date not recorded' : date.toLocaleDateString();
}

function formatMoney(money: OwnerServiceHistoryEntry['money'] | null | undefined): { label: string; recorded: boolean } {
  if (!money || !money.recorded || money.amount === null || money.amount === undefined || !money.currency) {
    return { label: 'Cost not recorded', recorded: false };
  }
  return { label: `${money.currency} ${Number(money.amount).toLocaleString()}`, recorded: true };
}

export function toServiceLogView(entry: OwnerServiceHistoryEntry): ServiceLogView {
  const cost = formatMoney(entry.money);
  const performed = entry.work_performed || entry.service_category || null;
  return {
    key: String(entry.id),
    vinLabel: entry.vin ? `VIN: ${String(entry.vin).slice(0, 8)}` : 'VIN not recorded',
    title: entry.description || entry.issue_description || 'Service details not recorded',
    dateLabel: formatDate(entry.created_at),
    costLabel: cost.label,
    costRecorded: cost.recorded,
    detail: performed ? { label: 'Work performed', value: performed } : null,
    statusLabel: entry.status || 'Status not recorded',
    authorizationLabel: entry.owner_authorization ? AUTHORIZATION_LABELS[entry.owner_authorization] ?? null : null,
  };
}
