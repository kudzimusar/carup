/**
 * RC2 residual guard — no effect may depend on the useCarUpApi() aggregate, directly or through a
 * callback or memo built from it.
 *
 * The aggregate is a NEW object on every render, and it must be: it carries the hook's own `loading`
 * and `error`, which every request changes. An effect that depends on it — or on a useCallback/useMemo
 * whose dependencies include it — re-runs after every request it makes, for as long as the page is
 * open. The Diaspora AI Command Center did exactly that (330 loads in 1.5 s at 20 ms latency). Nine
 * other pages hold the aggregate safely: their load effects depend on stable primitives. This keeps
 * every one of them, and every new page, that way.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

/** The text of the call whose `(` is at `open`, skipping strings, template literals and comments. */
function callAt(source: string, open: number): string {
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) break; continue }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2) + 1; if (i <= 0) break; continue }
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i += 1; i < source.length && source[i] !== ch; i += 1) if (source[i] === '\\') i += 1
      continue
    }
    if (ch === '(') depth += 1
    else if (ch === ')') { depth -= 1; if (depth === 0) return source.slice(open, i + 1) }
  }
  return ''
}

/** The identifiers in a hook call's trailing dependency array, or null when it has none. */
function dependencies(call: string): string[] | null {
  const match = /,\s*\[([^\]]*)\]\s*\)$/.exec(call)
  if (!match) return null
  return match[1].split(',').map((d) => d.trim().split(/[.?\s]/)[0]).filter(Boolean)
}

interface Finding { file: string; effect: string; via: string }

function findings(file: string, source: string): Finding[] {
  const aggregate = /const\s+(\w+)\s*=\s*useCarUpApi\(\)/.exec(source)?.[1]
  if (!aggregate) return []
  // Callbacks and memos, with their dependencies.
  const derived = new Map<string, string[]>()
  for (const m of source.matchAll(/const\s+(\w+)\s*=\s*use(?:Callback|Memo)\s*(?:<[^>]*>)?\s*\(/g)) {
    const deps = dependencies(callAt(source, m.index! + m[0].length - 1))
    if (deps) derived.set(m[1], deps)
  }
  // Taint, to a fixpoint: the aggregate, then anything that depends on something tainted.
  const tainted = new Map<string, string>([[aggregate, aggregate]])
  for (let changed = true; changed;) {
    changed = false
    for (const [name, deps] of derived) {
      const source_ = deps.find((d) => tainted.has(d))
      if (!tainted.has(name) && source_) { tainted.set(name, `${name} ← ${tainted.get(source_)}`); changed = true }
    }
  }
  const out: Finding[] = []
  for (const m of source.matchAll(/\buse(?:Layout)?Effect\s*\(/g)) {
    const call = callAt(source, m.index! + m[0].length - 1)
    for (const dep of dependencies(call) || []) {
      if (tainted.has(dep)) {
        const line = source.slice(0, m.index).split('\n').length
        out.push({ file: `${relative(SRC, file)}:${line}`, effect: dep, via: tainted.get(dep)! })
      }
    }
  }
  return out
}

describe('no effect depends on the useCarUpApi() aggregate', () => {
  const files = sourceFiles(SRC).map((file) => ({ file, source: readFileSync(file, 'utf8') }))
  const holders = files.filter(({ source }) => /const\s+\w+\s*=\s*useCarUpApi\(\)/.test(source))

  it('finds the pages that hold the aggregate (the scan is not vacuous)', () => {
    expect(holders.length).toBeGreaterThanOrEqual(10)
  })

  it('catches the shape it exists for', () => {
    const looped = `
      const api = useCarUpApi()
      const load = useCallback(async () => { setRows(await api.list()) }, [api, canView])
      useEffect(() => { void load() }, [canView, load])`
    expect(findings('fixture.tsx', looped).map((f) => f.via)).toEqual(['load ← api'])
  })

  it('no file has an effect that re-runs on every request', () => {
    const all = holders.flatMap(({ file, source }) => findings(file, source))
    expect(all.map((f) => `${f.file}  effect depends on ${f.via}`)).toEqual([])
  })
})
