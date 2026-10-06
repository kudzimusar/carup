/**
 * Adapter registration — Milestone 2.
 * Registers all available source adapters into the provider registry. Today this is the
 * fixture-backed sandbox JP auction adapter; real adapters are added here as they are built
 * and only flipped to mode:'live' after credentials + contract verification (master plan §2.6).
 */
import { registerProvider } from './sourceProvider.js';
import { sandboxJpAuctionAdapter } from './adapters/sandboxJpAuctionAdapter.js';
import { isDeployedRuntime } from '../../utils/runtimeEnvironment.js';

let registered = false;
export function registerAllAdapters(env = process.env) {
  if (registered) return;
  // The only currently shipped JP-auction adapter is fixture-backed. Keep it available for
  // local/test development, but never register it in staging/preview/production where a provider
  // listing could otherwise make sandbox inventory look operational.
  if (!isDeployedRuntime(env)) {
    registerProvider(sandboxJpAuctionAdapter);
  }
  registered = true;
}

export default { registerAllAdapters };
