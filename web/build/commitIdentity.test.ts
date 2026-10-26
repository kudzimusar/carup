import { describe, expect, it } from 'vitest'
import { resolveCommitSha, resolveGitRef } from './commitIdentity'

const SHA = '6a4f99668da5b9178a521c07622b5b88e3333773'

describe('which commit a bundle states', () => {
  it('uses the Git variable for a Git-sourced deployment', () => {
    expect(resolveCommitSha({ VERCEL_GIT_COMMIT_SHA: SHA })).toBe(SHA)
  })
  it('uses the deployer’s explicit SHA for a CLI upload, where no Git variable exists', () => {
    expect(resolveCommitSha({ CARUP_BUILD_SHA: SHA })).toBe(SHA)
  })
  it('states nothing when neither is present — a local build cannot certify', () => {
    expect(resolveCommitSha({})).toBe('')
    expect(resolveCommitSha({ CARUP_BUILD_SHA: '  ', VERCEL_GIT_COMMIT_SHA: '' })).toBe('')
  })
  it('accepts the two sources when they agree', () => {
    expect(resolveCommitSha({ VERCEL_GIT_COMMIT_SHA: SHA, CARUP_BUILD_SHA: SHA })).toBe(SHA)
  })
  it('refuses to build when the two sources name different commits', () => {
    expect(() => resolveCommitSha({ VERCEL_GIT_COMMIT_SHA: SHA, CARUP_BUILD_SHA: 'b'.repeat(40) })).toThrow(/different commits/)
  })
  it('does the same for the branch', () => {
    expect(resolveGitRef({ CARUP_BUILD_REF: 'feat/x' })).toBe('feat/x')
    expect(resolveGitRef({ VERCEL_GIT_COMMIT_REF: 'feat/x' })).toBe('feat/x')
    expect(resolveGitRef({})).toBe('')
    expect(() => resolveGitRef({ VERCEL_GIT_COMMIT_REF: 'a', CARUP_BUILD_REF: 'b' })).toThrow(/different branches/)
  })
})
