import type { VehicleCapabilities } from '@/types'
import { importJourneyPath, importOrderPath, sellerStudioPath, vehicleJourneyPath } from './workspaceModel'

/**
 * What a customer reads, and where each action goes, for a vehicle's two independent capabilities.
 * One pure function per capability, so the Vehicle Passport and My Garage can never word or route
 * the same fact differently.
 *
 * The rules this file exists to hold:
 *   - Marketplace and Trade & Imports are described separately; neither reads the other's state.
 *   - `none` (no readable import order) produces NO import view and NO CAP action — and nothing that
 *     implies a journey is missing or broken.
 *   - `unavailable` is a read that FAILED. It is worded as exactly that and never as "none" /
 *     "not listed". It carries no action that would act on a state we could not read.
 *   - Several import orders never resolve to one: the action is a chooser.
 */
export type CapabilityActionKind = 'manage' | 'continue' | 'sell' | 'view-listing' | 'view-cap' | 'choose-journey' | 'view-order'

export interface CapabilityAction {
  kind: CapabilityActionKind
  label: string
  href: string
}

export interface CapabilityView {
  /** The raw state, for `data-state` and for tests. */
  state: string
  label: string
  detail: string
  /** True when the underlying read failed: the surface should look like a fault, not a fact. */
  fault: boolean
  /** Primary first. */
  actions: CapabilityAction[]
}

export function describeMarketplaceCapability(vin: string, capability: VehicleCapabilities['marketplace']): CapabilityView {
  const sellerStudio = sellerStudioPath(vin)
  switch (capability.state) {
    case 'published':
      return {
        state: 'published', fault: false,
        label: 'Published on Marketplace',
        detail: 'Buyers can see this listing.',
        actions: [{ kind: 'manage', label: 'Manage listing', href: '/dashboard/listings' }],
      }
    case 'in_progress':
      return {
        state: 'in_progress', fault: false,
        label: 'Listing in progress',
        detail: 'A private draft. Nothing is public yet.',
        actions: [{ kind: 'continue', label: 'Continue listing', href: sellerStudio }],
      }
    case 'sold':
      return {
        state: 'sold', fault: false,
        label: 'Sold',
        detail: 'This vehicle has been marked sold.',
        actions: [{ kind: 'view-listing', label: 'View listing', href: '/dashboard/listings' }],
      }
    case 'not_listed':
      return {
        state: 'not_listed', fault: false,
        label: 'Not listed',
        detail: 'This vehicle has no Marketplace listing.',
        actions: [{ kind: 'sell', label: 'Sell this vehicle', href: sellerStudio }],
      }
    default:
      return {
        state: 'unavailable', fault: true,
        label: 'Marketplace status unavailable',
        detail: 'CarUp could not read this vehicle’s listing state just now. This is not a report that it is unlisted.',
        actions: [],
      }
  }
}

/** `null` for `none`: a vehicle with no readable import order simply has no Trade & Imports panel. */
export function describeTradeImportCapability(vin: string, capability: VehicleCapabilities['trade_import']): CapabilityView | null {
  switch (capability.state) {
    case 'single': {
      const orderId = typeof capability.order_id === 'string' && capability.order_id ? capability.order_id : null
      // A "single" without the order it names cannot be linked to; refuse to guess and fall back to the chooser.
      if (!orderId) {
        return {
          state: 'single', fault: false,
          label: 'Import journey available',
          detail: 'This vehicle is on an import order.',
          actions: [{ kind: 'choose-journey', label: 'View CAP', href: vehicleJourneyPath(vin) }],
        }
      }
      return {
        state: 'single', fault: false,
        label: 'Import journey available',
        detail: 'This vehicle is on an import order.',
        actions: [
          { kind: 'view-cap', label: 'View CAP', href: importJourneyPath(orderId) },
          { kind: 'view-order', label: 'Import order', href: importOrderPath(orderId) },
        ],
      }
    }
    case 'multiple': {
      const count = Number.isFinite(capability.count) && (capability.count as number) > 1 ? Number(capability.count) : null
      return {
        state: 'multiple', fault: false,
        label: count ? `${count} import journeys` : 'Several import journeys',
        detail: 'More than one import order includes this vehicle. You choose which to open.',
        actions: [{ kind: 'choose-journey', label: 'Choose import journey', href: vehicleJourneyPath(vin) }],
      }
    }
    case 'unavailable':
      return {
        state: 'unavailable', fault: true,
        label: 'Import status unavailable',
        detail: 'CarUp could not check this vehicle’s import orders just now. This is not a report that there are none.',
        actions: [],
      }
    default:
      return null
  }
}
