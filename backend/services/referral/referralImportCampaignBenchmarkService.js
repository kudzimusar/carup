import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { REFERRAL_TABLES } from './referralEngineRepository.js';
import { slugify } from './referralEngineService.js';
import { IMPORT_CAMPAIGN_EVENT_TYPES } from './referralImportCampaignService.js';
import { ReferralImportCampaignHardenedService } from './referralImportCampaignHardenedService.js';

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function nonNegativeNumber(value, label) {
  if (value === undefined || value === null || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new ValidationError(`${label} must be a non-negative number.`, { value });
  return Number(number.toFixed(2));
}

function sequenceFromId(id) {
  const match = String(id || '').match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function newestFirst(a, b) {
  const aTime = new Date(a.created_at || 0).getTime() || 0;
  const bTime = new Date(b.created_at || 0).getTime() || 0;
  if (aTime !== bTime) return bTime - aTime;
  return sequenceFromId(b.id) - sequenceFromId(a.id);
}

export class ReferralImportCampaignBenchmarkService extends ReferralImportCampaignHardenedService {
  async getRouteStatus(routeKey) {
    const key = slugify(routeKey);
    const events = await this.referralService.repository.list(
      REFERRAL_TABLES.events,
      { subject_type: 'import_route', subject_id: key },
      { orderBy: 'created_at', ascending: false },
    );
    const ordered = [...events].sort(newestFirst);
    const routeEvent = ordered.find((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.ROUTE_PAGE_CREATED) || null;
    const capacityEvent = ordered.find((event) => event.event_type === IMPORT_CAMPAIGN_EVENT_TYPES.CAPACITY_UPDATED) || null;
    if (!routeEvent && !capacityEvent) throw new NotFoundError('Import route status not found.', { route_key: key });
    const route = cleanObject(routeEvent?.metadata);
    const capacity = cleanObject(capacityEvent?.metadata || routeEvent?.metadata);
    return { success: true, route_key: key, route, capacity, history_count: events.length };
  }

  async preflightRequestedCapacity(input = {}, actor = {}) {
    const requested = nonNegativeNumber(input.requested_capacity_units ?? input.requested_cbm ?? input.requested_slots, 'requested_capacity_units');
    if (requested <= 0) return { requested, checked: false };
    const intent = this.classifyImportIntent(input, actor);
    let routeStatus = null;
    try {
      routeStatus = await this.getRouteStatus(intent.route_key);
    } catch {
      return { requested, checked: false };
    }
    const availableRaw = routeStatus?.capacity?.available_capacity_units;
    if (availableRaw === undefined || availableRaw === null) return { requested, checked: false, route_key: intent.route_key };
    const available = nonNegativeNumber(availableRaw, 'available_capacity_units');
    if (requested > available) {
      // Waitlist mode accepts the over-capacity request but flags it waitlisted.
      if (input.allow_waitlist === true) {
        return { requested, available, checked: true, waitlisted: true, route_key: intent.route_key };
      }
      throw new ValidationError('requested capacity exceeds available route capacity.', {
        route_key: intent.route_key,
        requested,
        available,
        capacity_status: routeStatus?.capacity?.capacity_status || null,
      });
    }
    return { requested, available, checked: true, route_key: intent.route_key };
  }

  async createLead(input = {}, actor = {}) {
    const capacity = await this.preflightRequestedCapacity(input, actor);
    return super.createLead(capacity?.waitlisted ? { ...input, waitlisted: true } : input, actor);
  }
}

export default ReferralImportCampaignBenchmarkService;
