import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveMarketplaceInquiryConversation,
} from '../utils/communicationApi';
import {
  canonicalObjectRouteFromCommunicationNotification,
  canonicalObjectRouteFromThread,
  nativeCanonicalObjectHref,
} from '../utils/nativeObjectRouting';
import { routeCanonicalPushPayload } from '../utils/pushNavigation';

describe('LR2-B inquiry to exact canonical conversation', () => {
  it('waits for asynchronous canonicalization and resolves only the exact inquiry/listing thread', async () => {
    const listThreads = vi.fn()
      .mockResolvedValueOnce({ threads: [] })
      .mockResolvedValueOnce({
        threads: [{
          id: 'thread-1',
          thread_type: 'marketplace_inquiry',
          subject_type: 'marketplace_inquiry',
          subject_id: 'inquiry-1',
          marketplace_listing_id: 'VIN-001',
        }],
      });

    const result = await resolveMarketplaceInquiryConversation('inquiry-1', 'VIN-001', {
      attempts: 2,
      intervalMs: 1,
      listThreads,
      sleep: async () => {},
    });

    expect(result.state).toBe('resolved');
    expect(result.thread?.id).toBe('thread-1');
    expect(result.inquiry_id).toBe('inquiry-1');
    expect(result.listing_id).toBe('VIN-001');
    expect(listThreads).toHaveBeenCalledTimes(2);
  });

  it('returns a deterministic pending state and never substitutes a generic Marketplace thread', async () => {
    const result = await resolveMarketplaceInquiryConversation('inquiry-pending', 'VIN-PENDING', {
      attempts: 1,
      listThreads: async () => ({
        threads: [{
          id: 'other-thread',
          subject_type: 'marketplace_inquiry',
          subject_id: 'other-inquiry',
          marketplace_listing_id: 'VIN-PENDING',
        }],
      }),
    });

    expect(result).toEqual({
      state: 'pending',
      inquiry_id: 'inquiry-pending',
      listing_id: 'VIN-PENDING',
    });
  });

  it('fails closed if the inquiry thread points at a different canonical listing', async () => {
    await expect(resolveMarketplaceInquiryConversation('inquiry-2', 'VIN-EXPECTED', {
      attempts: 1,
      listThreads: async () => ({
        threads: [{
          id: 'thread-2',
          subject_type: 'marketplace_inquiry',
          subject_id: 'inquiry-2',
          marketplace_listing_id: 'VIN-OTHER',
        }],
      }),
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('fails closed if canonical authority ever exposes duplicate threads for one inquiry', async () => {
    await expect(resolveMarketplaceInquiryConversation('inquiry-3', 'VIN-003', {
      attempts: 1,
      listThreads: async () => ({
        threads: [
          { id: 'thread-a', subject_type: 'marketplace_inquiry', subject_id: 'inquiry-3', marketplace_listing_id: 'VIN-003' },
          { id: 'thread-b', subject_type: 'marketplace_inquiry', subject_id: 'inquiry-3', marketplace_listing_id: 'VIN-003' },
        ],
      }),
    })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('LR2-B canonical object routing contract', () => {
  it('routes exact canonical thread and listing identifiers without parsing display copy', () => {
    expect(canonicalObjectRouteFromCommunicationNotification({
      title: 'VIN-EVIL should not be parsed',
      message: 'Open thread-not-authority',
      notification_type: 'conversation_message',
      thread_id: 'thread-4',
      payload: { listing_id: 'VIN-004' },
    })).toEqual({ type: 'conversation', id: 'thread-4' });

    expect(canonicalObjectRouteFromCommunicationNotification({
      payload: { marketplace_listing_id: 'VIN-005' },
    })).toEqual({ type: 'marketplace_listing', id: 'VIN-005' });

    expect(canonicalObjectRouteFromCommunicationNotification({
      title: 'VIN-006',
      message: 'conversation thread-6',
    })).toBeNull();
  });

  it('links a canonical Marketplace thread back to its exact vehicle', () => {
    const route = canonicalObjectRouteFromThread({
      subject_type: 'marketplace_inquiry',
      subject_id: 'inquiry-4',
      marketplace_listing_id: 'VIN-007',
    });
    expect(route).toEqual({ type: 'marketplace_listing', id: 'VIN-007' });
    expect(nativeCanonicalObjectHref(route!)).toBe('/vehicle/VIN-007');
  });

  it('rejects malformed and unsupported canonical object identifiers', () => {
    expect(canonicalObjectRouteFromCommunicationNotification({
      payload: { object_type: 'conversation', object_id: '../secret' },
    })).toBeNull();
    expect(canonicalObjectRouteFromCommunicationNotification({
      payload: { object_type: 'trade_order', object_id: 'order-1' },
    })).toBeNull();
  });

  it('never promotes a generic notification or event id into canonical object authority', () => {
    expect(canonicalObjectRouteFromCommunicationNotification({
      id: 'notification-row-1',
      payload: { object_type: 'vehicle', id: 'event-row-99' },
    })).toBeNull();
  });

  it('uses an actual notification row thread only for conversation messages', () => {
    expect(canonicalObjectRouteFromCommunicationNotification({
      id: 'notification-row-2',
      notification_type: 'listing_moderation',
      thread_id: 'trust-safety-thread',
      payload: { safe_payload: { vin: 'VIN-009' } },
    })).toEqual({ type: 'marketplace_listing', id: 'VIN-009' });

    expect(canonicalObjectRouteFromCommunicationNotification({
      id: 'notification-row-3',
      notification_type: 'conversation_message',
      thread_id: 'thread-9',
      payload: {},
    })).toEqual({ type: 'conversation', id: 'thread-9' });
  });
});

describe('LR2-B push tap authorization and safe fallback', () => {
  function harness(options: {
    authenticated?: boolean;
    conversationAllowed?: boolean;
    vehicleAllowed?: boolean;
  } = {}) {
    const events: string[] = [];
    return {
      events,
      deps: {
        isAuthenticated: () => options.authenticated ?? true,
        authorizeConversation: vi.fn(async () => options.conversationAllowed ?? true),
        authorizeVehicle: vi.fn(async () => options.vehicleAllowed ?? true),
        navigate: (href: string) => events.push(`navigate:${href}`),
        navigateToLogin: () => events.push('login'),
        navigateToInbox: () => events.push('inbox'),
        navigateToMarketplace: () => events.push('marketplace'),
      },
    };
  }

  it('opens an authorized canonical conversation', async () => {
    const h = harness({ authenticated: true, conversationAllowed: true });
    const result = await routeCanonicalPushPayload({ thread_id: 'thread-8' }, h.deps);
    expect(result.state).toBe('routed');
    expect(h.events).toEqual(['navigate:/inbox/thread-8']);
    expect(h.deps.authorizeConversation).toHaveBeenCalledWith('thread-8');
  });

  it('never opens protected content while signed out', async () => {
    const h = harness({ authenticated: false });
    const result = await routeCanonicalPushPayload({ thread_id: 'thread-private' }, h.deps);
    expect(result.state).toBe('auth_required');
    expect(h.events).toEqual(['login']);
    expect(h.deps.authorizeConversation).not.toHaveBeenCalled();
  });

  it('fails a stale or unauthorized thread to safe Inbox without leaking the guessed route', async () => {
    const h = harness({ authenticated: true, conversationAllowed: false });
    const result = await routeCanonicalPushPayload({ thread_id: 'thread-account-a' }, h.deps);
    expect(result.state).toBe('safe_fallback');
    expect(h.events).toEqual(['inbox']);
    expect(h.events.some((entry) => entry.includes('thread-account-a'))).toBe(false);
  });

  it('keeps Account A conversation authority out of Account B after an account boundary', async () => {
    const accountB = harness({ authenticated: true, conversationAllowed: false });
    await routeCanonicalPushPayload({ thread_id: 'account-a-thread' }, accountB.deps);
    expect(accountB.deps.authorizeConversation).toHaveBeenCalledWith('account-a-thread');
    expect(accountB.events).toEqual(['inbox']);
  });

  it('routes a valid Marketplace listing and safely falls back when the object is stale', async () => {
    const live = harness({ vehicleAllowed: true });
    await routeCanonicalPushPayload({ object_type: 'marketplace_listing', object_id: 'VIN-008' }, live.deps);
    expect(live.events).toEqual(['navigate:/vehicle/VIN-008']);

    const stale = harness({ vehicleAllowed: false });
    await routeCanonicalPushPayload({ marketplace_listing_id: 'VIN-DELETED' }, stale.deps);
    expect(stale.events).toEqual(['marketplace']);
  });

  it('sends malformed or unsupported payloads to a safe signed-in fallback', async () => {
    const h = harness();
    const result = await routeCanonicalPushPayload({ object_type: 'shipment', object_id: 'ship-1' }, h.deps);
    expect(result.state).toBe('safe_fallback');
    expect(h.events).toEqual(['inbox']);
  });
});

describe('LR2-B source integration preserves R6-B-R1 authority', () => {
  it('uses exact inquiry routing on Buyer and Seller surfaces and canonical thread to Vehicle return', () => {
    const vehicle = readFileSync(resolve('app/vehicle/[vin].tsx'), 'utf8');
    const home = readFileSync(resolve('app/(tabs)/index.tsx'), 'utf8');
    const thread = readFileSync(resolve('app/inbox/[threadId].tsx'), 'utf8');

    expect(vehicle).toContain('resolveMarketplaceInquiryConversation');
    expect(vehicle).toContain("type: 'conversation'");
    expect(vehicle).not.toContain("text: 'Open Inbox'");
    expect(home).toContain('Open exact conversation for newest seller inquiry');
    expect(home).toContain('resolveMarketplaceInquiryConversation');
    expect(thread).toContain('canonicalObjectRouteFromThread');
    expect(thread).toContain('label="Open vehicle"');
  });

  it('makes notifications actionable and installs warm/cold push response routing', () => {
    const inbox = readFileSync(resolve('app/(tabs)/inbox.tsx'), 'utf8');
    const root = readFileSync(resolve('app/_layout.tsx'), 'utf8');

    expect(inbox).toContain('canonicalObjectRouteFromCommunicationNotification');
    expect(inbox).toContain('markCommunicationNotificationRead');
    expect(root).toContain('getLastNotificationResponseAsync');
    expect(root).toContain('addNotificationResponseReceivedListener');
    expect(root).toContain('routeCanonicalPushPayload');
    expect(root).toContain('authorizeConversation');
  });

  it('retains R6-B-R1 scoped unread, resume refresh and explicit Marketplace return behavior', () => {
    const queries = readFileSync(resolve('utils/communicationQueries.ts'), 'utf8');
    const root = readFileSync(resolve('app/_layout.tsx'), 'utf8');
    const vehicle = readFileSync(resolve('app/vehicle/[vin].tsx'), 'utf8');

    expect(queries).toContain('scope.userId');
    expect(queries).toContain('scope.tenantId');
    expect(queries).toContain('scope.role');
    expect(root).toContain('invalidateQueries({ queryKey: communicationQueryKeys.root })');
    expect(root).toContain("refetchQueries({ queryKey: communicationQueryKeys.root, type: 'active' })");
    expect(vehicle).toContain('marketplaceReturnFromParam');
  });
});
