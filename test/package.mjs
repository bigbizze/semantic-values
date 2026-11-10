import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
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
    'dist/semantic.js', 'dist/semantic.d.ts', 'dist/plain-data.js', 'dist/plain-data.d.ts',
    'dist/errors.js', 'dist/errors.d.ts', 'dist/zod.js', 'dist/zod.d.ts'];
  assert.deepEqual(packed.files.map((entry) => entry.path).sort(), expected.sort());
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--package-lock=false', '--offline', '--no-audit', '--no-fund', join(temporary, packed.filename)], consumer);
  await assert.rejects(access(join(consumer, 'node_modules/zod')), 'Core consumer must not install the optional peer');
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
  // Regression: the optional subpath must typecheck and execute from the packed installation without making its peer mandatory for core.
  const zodPackage = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], fileURLToPath(new URL('../node_modules/zod/', import.meta.url))))[0];
  run('npm', ['install', '--offline', '--ignore-scripts', '--package-lock=false', '--no-audit', '--no-fund', join(temporary, zodPackage.filename)], consumer);
  await writeFile(join(consumer, 'codec.ts'), `
import { z } from 'zod';
import { defineSemantic } from '@bigbizze/semantic-values';
import { semanticCodec } from '@bigbizze/semantic-values/zod';
const a: unique symbol = Symbol('same');
const b: unique symbol = Symbol('same');
const options = { contract: 'same', version: 1, parse: z.string().parse };
const A = defineSemantic(a, options);
const B = defineSemantic(b, options);
const schema = z.object({ list: z.array(semanticCodec(A)), optional: semanticCodec(B).optional().nullable() });
const local = schema.parse({ list: [A.encode(A.create('value'))], optional: null });
A.read(local.list[0]!);
// @ts-expect-error -- package emission must retain identical-data identity distinction
B.read(local.list[0]!);
const wire: z.input<typeof schema> = z.encode(schema, local);
const text: string = wire.list[0]!.data;
// @ts-expect-error -- encoded representation cannot masquerade as the semantic output
A.read(wire.list[0]!);
// @ts-expect-error -- typed wire data must not widen to any
const wrong: number = wire.list[0]!.data;
void [text, wrong];
`);
  run(process.execPath, [compiler, '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2023', 'codec.ts'], consumer);
  await writeFile(join(consumer, 'codec.mjs'), `
import assert from 'node:assert/strict';
import { z } from 'zod';
import { defineSemantic } from '@bigbizze/semantic-values';
import { semanticCodec } from '@bigbizze/semantic-values/zod';
const Type = defineSemantic(Symbol('checked'), { contract: 'checked', version: 1, parse: z.string().min(1).parse });
const schema = z.object({ values: z.array(semanticCodec(Type)) });
const local = schema.parse({ values: [Type.encode(Type.create('value'))] });
assert.equal(Type.is(local.values[0]), true);
assert.equal(z.encode(schema, local).values[0].data, 'value');
const invalid = schema.safeParse({ values: [{ contract: 'checked', version: 1, data: '' }] });
assert.equal(invalid.success, false);
assert.deepEqual(invalid.error.issues[0].path, ['values', 0]);
`);
  run(process.execPath, ['codec.mjs'], consumer);
  await writeFile(join(consumer, 'domain.ts'), `
import { defineSemantic } from '@bigbizze/semantic-values';
import { z } from 'zod';
const identity: unique symbol = Symbol('label');
export const Label = defineSemantic(identity, { contract: 'example.label', version: 1, parse: z.string().parse });
export type Label = ReturnType<typeof Label.create>;
`);
  await writeFile(join(consumer, 'schema.ts'), `
import { z } from 'zod';
import { semanticCodec, type SemanticCodec } from '@bigbizze/semantic-values/zod';
import { Label } from './domain.js';
type Leaf = SemanticCodec<Label, ReturnType<typeof Label.encode>>;
export const Composed: z.ZodObject<{ label: Leaf; labels: z.ZodArray<Leaf> }> = z.object({
  label: semanticCodec(Label), labels: z.array(semanticCodec(Label)),
});
`);
  run(process.execPath, [compiler, '--strict', '--declaration', '--emitDeclarationOnly', '--outDir', 'public', '--module', 'NodeNext', '--target', 'ES2023', 'schema.ts'], consumer);
  await writeFile(join(consumer, 'public-consumer.ts'), `
import { z } from 'zod';
import { Composed } from './public/schema.js';
import { Label } from './public/domain.js';
declare const data: z.output<typeof Composed>;
Label.read(data.label);
const wire: z.input<typeof Composed> = z.encode(Composed, data);
const text: string = wire.label.data;
// @ts-expect-error -- declarations of a composed schema must still distinguish handles from wire data
Label.read(wire.label);
void text;
`);
  run(process.execPath, [compiler, '--strict', '--noEmit', '--module', 'NodeNext', '--target', 'ES2023', 'public-consumer.ts'], consumer);
  console.log('Packed core without Zod, optional codec exports, declarations, modules and process reconstruction passed.');
} finally { await rm(temporary, { recursive: true, force: true }); }
