/**
 * Which commit is this web bundle built from?
 *
 * Vercel's Git variable when the deployment came from a connected Git repository; the deployer's explicit
 * `CARUP_BUILD_SHA` for a CLI upload (the CarUp projects have no connected Git repository, so every exact-commit
 * Preview is a CLI upload and `VERCEL_GIT_COMMIT_SHA` does not exist for it). The running app compares this to the
 * backend's `/api/health` commit, so an unpaired Preview is refused rather than silently measured.
 *
 * Fails closed: if both are present and they DISAGREE the build stops — a bundle must never state a revision two
 * sources contradict.
 */
export function resolveCommitSha(env: Record<string, string | undefined>): string {
  const git = (env.VERCEL_GIT_COMMIT_SHA ?? '').trim()
  const explicit = (env.CARUP_BUILD_SHA ?? '').trim()
  if (git && explicit && git !== explicit) {
    throw new Error(`Refusing to build: VERCEL_GIT_COMMIT_SHA (${git}) and CARUP_BUILD_SHA (${explicit}) name different commits`)
  }
  return git || explicit
}

export function resolveGitRef(env: Record<string, string | undefined>): string {
  const git = (env.VERCEL_GIT_COMMIT_REF ?? '').trim()
  const explicit = (env.CARUP_BUILD_REF ?? '').trim()
  if (git && explicit && git !== explicit) {
    throw new Error(`Refusing to build: VERCEL_GIT_COMMIT_REF (${git}) and CARUP_BUILD_REF (${explicit}) name different branches`)
  }
  return git || explicit
}
