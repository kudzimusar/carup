/**
 * Adapter registration — Milestone 2.
 * Registers all available source adapters into the provider registry. Today this is the
 * fixture-backed sandbox JP auction adapter; real adapters are added here as they are built
 * and only flipped to mode:'live' after credentials + contract verification (master plan §2.6).
 */
import { registerProvider } from './sourceProvider.js';
import { sandboxJpAuctionAdapter } from './adapters/sandboxJpAuctionAdapter.js';
import { isProductionLikeRuntime } from '../../utils/runtimeEnvironment.js';

let registered = false;
export function registerAllAdapters() {
  if (registered) return;
  // Fixture ingestion is local/test only. A deployed runtime reports the provider unavailable until
  // a real authenticated auction adapter is selected.
  if (!isProductionLikeRuntime(process.env)) registerProvider(sandboxJpAuctionAdapter);
  registered = true;
}

export default { registerAllAdapters };
