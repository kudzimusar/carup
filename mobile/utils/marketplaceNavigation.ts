import {
  marketplaceResultsHref,
  serializeMarketplaceFilters,
  type MarketplaceFilters,
} from './marketplaceFilters';

type SearchParam = string | string[] | undefined;

function first(value: SearchParam): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export function marketplaceResultsReturnHref(
  filters: MarketplaceFilters,
  options: { savedMode?: boolean; savedSearch?: string } = {},
): string {
  if (!options.savedMode) return marketplaceResultsHref(filters);

  const serialized = serializeMarketplaceFilters({
    ...filters,
    q: (options.savedSearch ?? filters.q).trim(),
  });
  return `/market/results?saved=true${serialized ? `&${serialized}` : ''}`;
}

export function marketplaceVehicleHref(vin: string, returnHref: string): string {
  return `/vehicle/${encodeURIComponent(vin)}?marketReturn=${encodeURIComponent(returnHref)}`;
}

/**
 * Vehicle Detail may only navigate back into the Marketplace Results route. This prevents a
 * server/user supplied query value from becoming an arbitrary internal route target.
 */
export function marketplaceReturnFromParam(value: SearchParam): string | null {
  const raw = first(value).trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw, 'https://carup.invalid');
    if (parsed.origin !== 'https://carup.invalid' || parsed.pathname !== '/market/results' || parsed.hash) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}
