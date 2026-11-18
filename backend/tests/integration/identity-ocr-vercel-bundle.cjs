/** Offline Vercel Express builder probe. Use an isolated dependency install and a copied backend. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const [builderDirectory, backendDirectory, outputDirectory] = process.argv.slice(2);
assert.ok(builderDirectory && backendDirectory && outputDirectory, 'Provide the builder install, copied backend and new artifact directory.');
assert.equal(process.env.npm_config_offline, 'true');
const builderRequire = createRequire(path.resolve(builderDirectory, 'package.json'));
const { build } = builderRequire('@vercel/express');
const { glob } = builderRequire('@vercel/build-utils');
const root = fs.realpathSync(backendDirectory);
const stage = path.resolve(outputDirectory);
assert.ok(!fs.existsSync(stage), 'Use a new artifact directory.');

async function main() {
  const files = Object.fromEntries(Object.entries(await glob('**', root)).filter(([name]) => !name.startsWith('node_modules/')));
  const config = {
    ...JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')),
    projectSettings: { installCommand: '' },
  };
  const result = await build({ files, entrypoint: 'package.json', workPath: root, config,
    meta: { isDev: false, skipDownload: true }, repoRootPath: root });
  const lambda = result.output.files ? result.output : Object.values(result.output).find(item => item?.files);
  assert.ok(lambda?.files, 'The Express builder must produce a traced function.');
  const entries = Object.entries(lambda.files);
  fs.mkdirSync(stage, { recursive: true });
  let totalBytes = 0;
  for (const [name, data] of entries) {
    const output = path.resolve(stage, name);
    assert.ok(output.startsWith(stage + path.sep), 'Unexpected artifact path.');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    if (data.type === 'FileBlob') fs.writeFileSync(output, data.data, { mode: data.mode });
    else if (data.type === 'FileFsRef') fs.copyFileSync(data.fsPath, output);
    else throw new Error('Unknown artifact reference');
    totalBytes += fs.statSync(output).size;
  }
  const required = [
    'services/identity/localIdentityOcrWorker.js',
    'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
    'node_modules/tesseract.js-core/tesseract-core-lstm.wasm',
    'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm',
  ];
  const native = entries.map(([name]) => name).filter(name => name.startsWith('node_modules/@img/') && name.endsWith('.node'));
  const assets = [...required, ...native].map(name => {
    const inBundle = Object.hasOwn(lambda.files, name);
    if (!inBundle) return { name, present: false };
    const bytes = fs.readFileSync(path.join(stage, name));
    return { name, present: true, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  console.log(JSON.stringify({ handler: lambda.handler, runtime: lambda.runtime, fileCount: entries.length, totalBytes, assets }, null, 2));
  assert.ok(native.length, 'Sharp native module is missing.');
  assert.ok(assets.every(asset => asset.present), 'Required OCR assets are missing from the function artifact.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
