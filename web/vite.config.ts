import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"
import { loadPairingFile, resolvePreviewApiUrl } from "./build/previewPairing"

// ── Candidate provenance (Issue #164 Phase 8, Cluster I) ────────────────────────────────────────
// A per-branch preview must be built against ITS OWN backend preview. The first Phase 8 physical UAT
// was invalidated because the preview frontend silently used the stable staging backend, which serves
// `main`. `resolvePreviewApiUrl` fails closed when a preview cannot be paired.
//
// These are assigned onto `process.env` rather than injected via `define` because Vite exposes every
// `VITE_`-prefixed process env var through `import.meta.env` during config resolution. `define` would
// have to match the source text `import.meta.env?.VITE_API_URL` (with the optional chain) exactly, and
// silently no-ops when it does not.
const pairing = resolvePreviewApiUrl({
  configuredApiUrl: process.env.VITE_API_URL,
  vercelEnv: process.env.VERCEL_ENV,
  gitRef: process.env.VERCEL_GIT_COMMIT_REF,
  pairing: loadPairingFile(),
})
if (pairing.apiUrl) process.env.VITE_API_URL = pairing.apiUrl
// The SHA this bundle was built from, so the running app can prove which candidate it is and compare
// itself against the backend's `/api/health`. Empty when built outside Vercel (local/dev).
// R14 — demo identities must never reach a production build.
//
// The login page shipped three hard-coded demo accounts and a hard-coded password, rendered
// unconditionally: they were live on production. The build, not the page, decides whether they
// exist, and it FAILS CLOSED — the flag is only ever set for a non-production Vercel environment,
// so any build that does not positively identify itself as preview/development ships without them.
process.env.VITE_ALLOW_DEMO_LOGINS =
  process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production' ? 'true' : ''

process.env.VITE_COMMIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA ?? ''
process.env.VITE_GIT_REF = process.env.VERCEL_GIT_COMMIT_REF ?? ''
// Surfaced in the build log so a mis-paired preview is visible in CI output, not only at runtime.
console.log(
  `[carup] API base for this build: ${pairing.apiUrl ?? '(runtime host resolution)'} — ${pairing.reason}`,
)
if (pairing.unpaired) {
  console.warn(
    '[carup] UNPAIRED PREVIEW: this build cannot reach a backend. Add the branch to '
    + 'web/preview-backend-pairing.json before running a physical UAT against it.',
  )
}

/**
 * Emit `/carup-provenance.json` describing what this build is paired to.
 *
 * The receipt script needs to know the API base the browser will actually use. Reading it back out of
 * the bundle is not reliable: Vite INLINES `import.meta.env.VITE_API_URL` at each call site, while
 * `DEFAULT_STAGING_API_BASE_URL` remains present as an unused constant — so "the stable staging host
 * appears in the bundle" says nothing about which base is live. (That false positive blocked a
 * correctly-paired preview on the first run of the guard.) The build states it instead.
 */
function provenanceManifest() {
  return {
    name: 'carup-provenance-manifest',
    apply: 'build' as const,
    generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
      this.emitFile({
        type: 'asset',
        fileName: 'carup-provenance.json',
        source: JSON.stringify({
          commit_sha: process.env.VITE_COMMIT_SHA || null,
          git_ref: process.env.VITE_GIT_REF || null,
          api_base_url: process.env.VITE_API_URL || null,
          api_base_source: pairing.reason,
          unpaired: pairing.unpaired,
        }, null, 2),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react(), provenanceManifest()],
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  test: {
    exclude: [
      "e2e/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
});
