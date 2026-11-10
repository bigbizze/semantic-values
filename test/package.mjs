import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const temporary = await mkdtemp(join(tmpdir(), 'semantic-values-'));
const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
function run(command, args, cwd, input) {
  const result = spawnSync(command, args, { cwd, input, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
try {
  // Regression: published exports and declarations must work without access to source internals or development dependencies.
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], process.cwd()))[0];
  const expected = ['README.md', 'package.json', 'dist/index.js', 'dist/index.d.ts',
    'dist/semantic.js', 'dist/semantic.d.ts', 'dist/plain-data.js', 'dist/plain-data.d.ts'];
  assert.deepEqual(packed.files.map((entry) => entry.path).sort(), expected.sort());
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--package-lock=false', '--offline', '--no-audit', '--no-fund', join(temporary, packed.filename)], consumer);
  await writeFile(join(consumer, 'types.ts'), `
import { defineSemantic } from '@bigbizze/semantic-values';
const a: unique symbol = Symbol('same');
const b: unique symbol = Symbol('same');
const options = { contract: 'example.same', version: 1, parse: (_: unknown) => 'value' };
const A = defineSemantic(a, options);
const B = defineSemantic(b, options);
const value = A.create(null);
A.read(value);
// @ts-expect-error -- declaration emission must retain identical-data identity separation
B.read(value);
// @ts-expect-error -- ordinary objects cannot substitute through emitted declarations
A.encode({});
// @ts-expect-error -- public data must not appear in emitted declarations
value.data;
const Numeric = defineSemantic(a, { ...options, parse: () => 1 });
// @ts-expect-error -- declaration emission must retain generic data distinctions
Numeric.read(value);
// @ts-expect-error -- source subpaths are not package exports
import '@bigbizze/semantic-values/src/semantic.js';
`);
  run(process.execPath, [compiler, '--noEmit', '--strict', '--noUncheckedSideEffectImports', '--module', 'NodeNext', '--target', 'ES2023', 'types.ts'], consumer);
  await writeFile(join(consumer, 'definition.mjs'), `
import { defineSemantic } from '@bigbizze/semantic-values';
const identity = Symbol('label');
export const Label = defineSemantic(identity, { contract: 'example.label', version: 1, parse(input) {
  if (typeof input !== 'string' || !/^[a-z]+$/.test(input)) throw new TypeError('Expected lowercase letters');
  return input;
} });
`);
  await writeFile(join(consumer, 'receive.mjs'), `
import { readFileSync } from 'node:fs';
import { Label } from './definition.mjs';
const decoded = JSON.parse(readFileSync(0, 'utf8'));
if (Label.is(decoded)) throw new Error('Parsed data must not be a member');
process.stdout.write(Label.read(Label.decode(decoded)));
`);
  await writeFile(join(consumer, 'modules.mjs'), `
import assert from 'node:assert/strict';
import { Label as A } from './definition.mjs?first';
import { Label as B } from './definition.mjs?second';
const value = A.create('sample');
assert.equal(B.is(value), false);
assert.throws(() => B.read(value));
assert.throws(() => B.encode(value));
const decoded = B.decode(JSON.parse(JSON.stringify(value)));
assert.equal(B.is(decoded), true);
assert.equal(A.is(decoded), false);
assert.equal(B.read(decoded), 'sample');
assert.throws(() => B.decode({ ...A.encode(value), data: 'INVALID' }));
process.stdout.write(JSON.stringify(value));
`);
  // Regression: independent definition executions and another process must reconstruct, not share private authority.
  const wire = run(process.execPath, ['modules.mjs'], consumer);
  assert.equal(run(process.execPath, ['receive.mjs'], consumer, wire), 'sample');
  console.log('Packed exports, emitted declarations, independent modules and process reconstruction passed.');
} finally { await rm(temporary, { recursive: true, force: true }); }
