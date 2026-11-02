// Exercise emitted ESM in Node, rather than Vite's forgiving module resolver.
import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

function emitAndRun(env: Record<string, string>, path = 'marketplace') {
  const root = mkdtempSync(join(tmpdir(), 'carup-public-document-'))
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}')
    for (const file of ['api/public-page.ts', 'src/config/publicPageMetadata.ts', 'src/config/featureRegistry.ts', 'src/config/publicLaunchPolicy.ts']) {
      const output = join(root, 'web', file.replace(/\.ts$/, '.js'))
      mkdirSync(dirname(output), { recursive: true })
      const code = ts.transpileModule(readFileSync(resolve(file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
      writeFileSync(output, code)
    }
    mkdirSync(join(root, 'web/dist'), { recursive: true })
    writeFileSync(join(root, 'web/dist/index.html'), '<html><head><title>shell</title></head><body></body></html>')
    const url = pathToFileURL(join(root, 'web/api/public-page.js')).href
    const script = `const {default: handler}=await import(${JSON.stringify(url)});let body='';const headers={};const res={setHeader(k,v){headers[k]=v},end(value){body=value},statusCode:0};await handler({url:'/api/public-page?path=${path}'},res);console.log(JSON.stringify({status:res.statusCode,body,headers}));`
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: tmpdir(), env, encoding: 'utf8' }))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

describe('public document Node deployment contract', () => {
  it('loads emitted ESM and finds the traced shell independently of the working directory', () => {
    const result = emitAndRun({ VERCEL_ENV: 'preview' })
    expect(result.status).toBe(200)
    expect(result.body).toContain('https://carup.dev/marketplace')
    expect(result.body).toContain('noindex, nofollow')
    expect(result.body).not.toContain('<title>shell</title>')
  })
  it('serves indexable, cacheable public metadata only on the carup.dev production project', () => {
    const production = emitAndRun({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'carup.dev' })
    expect(production.status).toBe(200)
    expect(production.body).toContain('index, follow')
    expect(production.headers['X-Robots-Tag']).toBe('index, follow')
    expect(production.headers['Cache-Control']).toContain('s-maxage')
    const stagingTarget = emitAndRun({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'staging.carup.dev' })
    expect(stagingTarget.headers['X-Robots-Tag']).toBe('noindex, nofollow')
    expect(stagingTarget.headers['Cache-Control']).toBe('private, no-store')
  })
  it('keeps hidden, legal-blocked and private routes out of search even on production', () => {
    const env = { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'carup.dev' }
    for (const path of ['careers', 'privacy', 'dashboard/garage', 'pricing']) {
      expect(emitAndRun(env, path).headers['X-Robots-Tag'], path).toBe('noindex, nofollow')
    }
    expect(emitAndRun(env, 'not-a-carup-route').status).toBe(404)
  })
})
