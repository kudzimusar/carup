/**
 * The five Zimbabwe registry verification adapters — Workstream 2.
 *
 * Each is currently a SANDBOX adapter (synthetic fixtures). When a real provider
 * endpoint + credential or a signed partner-file feed becomes available, the
 * corresponding adapter swaps its mode/verify() implementation WITHOUT any change to the
 * orchestrator, persistence, routes, or UI — the verification contract is the seam.
 *
 * Honest legal_basis strings make clear this is sandbox demonstration data, not a live
 * government API confirmation.
 */
import { buildSandboxAdapter } from './sandboxAdapterFactory.js';

/**
 * Build all five adapters. `flags` is an optional map of provider -> () => boolean
 * enablement checks (wired to feature governance). A disabled adapter fails closed to
 * an 'unavailable' / 'not_contracted' result.
 */
export function buildRegistryAdapters(flags = {}) {
  return [
    buildSandboxAdapter({
      provider: 'zimra',
      displayName: 'ZIMRA (Customs & Import Duty)',
      supportedQueryTypes: ['vin', 'chassis'],
      legalBasis: 'SANDBOX demonstration of customs/import-duty verification. Not a live ZIMRA API confirmation.',
      isEnabled: flags.zimra,
    }),
    buildSandboxAdapter({
      provider: 'cvr',
      displayName: 'Central Vehicle Registry (Registration & Ownership)',
      supportedQueryTypes: ['vin', 'plate'],
      legalBasis: 'SANDBOX demonstration of CVR registration/ownership verification. Not a live CVR API confirmation. Private owner identity is never exposed publicly.',
      isEnabled: flags.cvr,
    }),
    buildSandboxAdapter({
      provider: 'zinara',
      displayName: 'ZINARA (Road Licensing)',
      supportedQueryTypes: ['plate', 'vin'],
      legalBasis: 'SANDBOX demonstration of ZINARA road-licence verification. Not a live ZINARA API confirmation.',
      isEnabled: flags.zinara,
    }),
    buildSandboxAdapter({
      provider: 'vid',
      displayName: 'VID (Vehicle Inspection / Roadworthiness)',
      supportedQueryTypes: ['vin'],
      legalBasis: 'SANDBOX demonstration of VID roadworthiness verification. Not a live VID API confirmation.',
      isEnabled: flags.vid,
    }),
    buildSandboxAdapter({
      provider: 'cid',
      displayName: 'CID (Police Clearance / Stolen Check)',
      supportedQueryTypes: ['vin', 'chassis', 'engine'],
      legalBasis: 'SANDBOX demonstration of CID stolen/clearance verification. Not a live CID API confirmation. Access is strictly audit-logged.',
      isEnabled: flags.cid,
    }),
  ];
}

export default { buildRegistryAdapters };
