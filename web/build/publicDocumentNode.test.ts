// Exercise emitted ESM in Node, rather than Vite's forgiving module resolver.
import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

describe('public document Node deployment contract', () => {
  it('loads emitted ESM and finds the traced shell independently of the working directory', () => {
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
      const script = `const {default: handler}=await import(${JSON.stringify(url)});let body='';const res={setHeader(){},end(value){body=value},statusCode:0};await handler({url:'/api/public-page?path=marketplace'},res);console.log(JSON.stringify({status:res.statusCode,body}));`
      const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: tmpdir(), env: { VERCEL_ENV: 'preview' }, encoding: 'utf8' }))
      expect(result.status).toBe(200)
      expect(result.body).toContain('https://carup.dev/marketplace')
      expect(result.body).toContain('noindex, nofollow')
      expect(result.body).not.toContain('<title>shell</title>')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
