export type MarketplaceSort = 'newest' | 'price-low' | 'price-high' | 'trust';

export interface MarketplaceFilters {
  q: string;
  make: string;
  model: string;
  year: string;
  color: string;
  bodyStyle: string;
  location: string;
  fuel: string;
  transmission: string;
  minPrice: string;
  maxPrice: string;
  condition: string;
  tags: string[];
  sort: MarketplaceSort;
}

export const MARKETPLACE_TRUST_FILTERS = [
  { value: 'passport_verified', label: 'Passport Verified' },
  { value: 'partsentry_checked', label: 'PartSentry Checked' },
  { value: 'dealer_verified', label: 'Dealer Verified' },
] as const;

export const MARKETPLACE_CONDITIONS = [
  { value: 'brand_new', label: 'Brand new' },
  { value: 'recently_imported', label: 'Recently imported' },
  { value: 'locally_used', label: 'Locally used' },
  { value: 'second_hand', label: 'Second hand' },
  { value: 'certified_dealer', label: 'Certified dealer' },
  { value: 'unknown', label: 'Unknown / not recorded' },
] as const;

export const MARKETPLACE_SORTS: { value: MarketplaceSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-low', label: 'Price: low to high' },
  { value: 'price-high', label: 'Price: high to low' },
  { value: 'trust', label: 'Trust' },
];

export const EMPTY_MARKETPLACE_FILTERS: MarketplaceFilters = {
  q: '',
  make: '',
  model: '',
  year: '',
  color: '',
  bodyStyle: '',
  location: '',
  fuel: '',
  transmission: '',
  minPrice: '',
  maxPrice: '',
  condition: '',
  tags: [],
  sort: 'newest',
};

type SearchParamValue = string | string[] | undefined;

function first(value: SearchParamValue): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export function marketplaceFiltersFromParams(params: Record<string, SearchParamValue>): MarketplaceFilters {
  const rawSort = first(params.sort);
  const sort: MarketplaceSort = MARKETPLACE_SORTS.some((item) => item.value === rawSort)
    ? rawSort as MarketplaceSort
    : 'newest';
  const tags = first(params.tag)
    .split(',')
    .map((value) => value.trim())
    .filter((value, index, all) =>
      MARKETPLACE_TRUST_FILTERS.some((item) => item.value === value) && all.indexOf(value) === index,
    );
  return {
    q: first(params.q),
    make: first(params.make),
    model: first(params.model),
    year: first(params.year),
    color: first(params.color),
    bodyStyle: first(params.bodyStyle) || first(params.body_style) || first(params.body),
    location: first(params.location),
    fuel: first(params.fuel),
    transmission: first(params.transmission),
    minPrice: first(params.minPrice),
    maxPrice: first(params.maxPrice),
    condition: first(params.condition),
    tags,
    sort,
  };
}

export function marketplaceApiQuery(filters: MarketplaceFilters): Record<string, string | number | undefined> {
  const query: Record<string, string | number | undefined> = {};
  if (filters.q.trim()) query.q = filters.q.trim();
  if (filters.make.trim()) query.make = filters.make.trim();
  if (filters.model.trim()) query.model = filters.model.trim();
  if (filters.year.trim()) query.year = filters.year.trim();
  if (filters.color.trim()) query.color = filters.color.trim();
  if (filters.bodyStyle.trim()) query.bodyStyle = filters.bodyStyle.trim();
  if (filters.location.trim()) query.location = filters.location.trim();
  if (filters.fuel.trim()) query.fuel = filters.fuel.trim();
  if (filters.transmission.trim()) query.transmission = filters.transmission.trim();
  if (filters.minPrice.trim()) query.minPrice = filters.minPrice.trim();
  if (filters.maxPrice.trim()) query.maxPrice = filters.maxPrice.trim();
  if (filters.condition.trim()) query.condition = filters.condition.trim();
  if (filters.tags.length) query.tag = filters.tags.join(',');
  if (filters.sort !== 'newest') query.sort = filters.sort;
  return query;
}

export function serializeMarketplaceFilters(filters: MarketplaceFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(marketplaceApiQuery(filters))) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export function marketplaceResultsHref(filters: MarketplaceFilters): string {
  const query = serializeMarketplaceFilters(filters);
  return `/market/results${query ? `?${query}` : ''}`;
}

export function activeMarketplaceFilterCount(filters: MarketplaceFilters): number {
  return [
    filters.make,
    filters.model,
    filters.year,
    filters.color,
    filters.bodyStyle,
    filters.location,
    filters.fuel,
    filters.transmission,
    filters.minPrice,
    filters.maxPrice,
    filters.condition,
  ].filter((value) => value.trim()).length + filters.tags.length;
}

export type MarketplaceFilterKey =
  | 'make' | 'model' | 'year' | 'color' | 'bodyStyle' | 'location' | 'fuel'
  | 'transmission' | 'minPrice' | 'maxPrice' | 'condition' | 'tag';

export interface MarketplaceFilterChip {
  key: MarketplaceFilterKey;
  value: string;
  label: string;
}

function human(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function activeMarketplaceFilterChips(filters: MarketplaceFilters): MarketplaceFilterChip[] {
  const chips: MarketplaceFilterChip[] = [];
  const add = (key: MarketplaceFilterKey, label: string, value: string) => {
    if (value.trim()) chips.push({ key, value, label: `${label}: ${human(value.trim())}` });
  };
  add('make', 'Make', filters.make);
  add('model', 'Model', filters.model);
  add('year', 'Year', filters.year);
  add('color', 'Colour', filters.color);
  add('bodyStyle', 'Body', filters.bodyStyle);
  add('location', 'Location', filters.location);
  add('fuel', 'Fuel', filters.fuel);
  add('transmission', 'Transmission', filters.transmission);
  add('minPrice', 'Min', filters.minPrice);
  add('maxPrice', 'Max', filters.maxPrice);
  add('condition', 'Condition', filters.condition);
  for (const tag of filters.tags) {
    const option = MARKETPLACE_TRUST_FILTERS.find((item) => item.value === tag);
    chips.push({ key: 'tag', value: tag, label: option?.label || human(tag) });
  }
  return chips;
}

export function removeMarketplaceFilter(
  filters: MarketplaceFilters,
  key: MarketplaceFilterKey,
  value?: string,
): MarketplaceFilters {
  if (key === 'tag') {
    return { ...filters, tags: filters.tags.filter((tag) => tag !== value) };
  }
  return { ...filters, [key]: '' };
}

export function clearMarketplaceFilters(filters?: MarketplaceFilters): MarketplaceFilters {
  return { ...EMPTY_MARKETPLACE_FILTERS, q: filters?.q || '' };
}
