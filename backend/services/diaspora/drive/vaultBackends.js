/**
 * The one place that decides which managed credential-vault backends this build can construct.
 *
 * `credentialVault.js` deliberately does not import any backend (see the registry comment there: a
 * core → backend → core cycle makes `class … extends CredentialVault` evaluate inside a temporal dead
 * zone, and whether that throws depends on module load order). So SOMETHING has to pull the backend
 * modules in, and it should be explicit and greppable rather than a side effect hidden in whichever
 * file happened to need it.
 *
 * Importing this module is what makes `resolveVault()` able to return a managed vault. Every entry
 * point that can reach `resolveVault` imports it.
 */
import { registeredManagedVaultBackends } from './credentialVault.js';
import './googleSecretManagerVault.js';

/**
 * Idempotent: registration already happened at import time. Returns the backend ids that are now
 * constructible, which is what a health endpoint should report — a list of names, never a value.
 */
export function installManagedVaultBackends() {
  return registeredManagedVaultBackends();
}

export default installManagedVaultBackends;
