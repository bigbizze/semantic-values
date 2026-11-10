import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const temporary = await mkdtemp(join(tmpdir(), 'semantic-values-'));
const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
function run(command, args, cwd, input) {
  // A parent publish dry-run must still create and install the test's isolated tarballs.
  const result = spawnSync(command, args, {
    cwd, input, encoding: 'utf8', timeout: 30000, env: { ...process.env, npm_config_dry_run: 'false' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
try {
  // Regression: published exports and declarations must work without access to source internals.
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], process.cwd()))[0];
  const expected = ['README.md', 'LICENSE', 'docs/API.md', 'package.json', 'dist/index.js', 'dist/index.d.ts',
    'dist/semantic.js', 'dist/semantic.d.ts', 'dist/plain-data.js', 'dist/plain-data.d.ts',
];
  assert.deepEqual(packed.files.map((entry) => entry.path).sort(), expected.sort());
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const zodPackage = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], fileURLToPath(new URL('../node_modules/zod/', import.meta.url))))[0];
  run('npm', ['install', '--ignore-scripts', '--package-lock=false', '--offline', '--no-audit', '--no-fund', join(temporary, packed.filename), join(temporary, zodPackage.filename)], consumer);

  await writeFile(join(consumer, 'types.ts'), `
import { defineSemantic } from '@bigbizze/semantic-values';
import { z } from 'zod';
const a: unique symbol = Symbol('same');
const b: unique symbol = Symbol('same');
const options = { schema: z.string() };
const A = defineSemantic(a, options);
const B = defineSemantic(b, options);
const value = A.create('value');
A.read(value);
// @ts-expect-error -- declaration emission must retain identical-data identity separation
B.read(value);
// @ts-expect-error -- ordinary objects cannot substitute through emitted declarations
A.encode({});
// @ts-expect-error -- public data must not appear in emitted declarations
value.data;
const Numeric = defineSemantic(a, { schema: z.number() });
// @ts-expect-error -- declaration emission must retain generic data distinctions
Numeric.read(value);
// @ts-expect-error -- source subpaths are not package exports
import '@bigbizze/semantic-values/src/semantic.js';
`);
  run(process.execPath, [compiler, '--noEmit', '--strict', '--noUncheckedSideEffectImports', '--module', 'NodeNext', '--target', 'ES2023', 'types.ts'], consumer);
  await writeFile(join(consumer, 'definition.mjs'), `
import { defineSemantic } from '@bigbizze/semantic-values';
import { z } from 'zod';
const identity = Symbol('label');
export const Label = defineSemantic(identity, { schema: z.string().regex(/^[a-z]+$/) });
export const Message = z.object({ labels: z.array(Label.codec) });
`);
  await writeFile(join(consumer, 'receive.mjs'), `
import { readFileSync } from 'node:fs';
import { Label, Message } from './definition.mjs';
const decoded = JSON.parse(readFileSync(0, 'utf8'));
if (Label.is(decoded)) throw new Error('Parsed data must not be a member');
const local = process.argv[2] === 'direct' ? Label.create(decoded) : Message.parse(decoded).labels[0];
if (!Label.is(local)) throw new Error('Receiver must establish local membership');
process.stdout.write(Label.read(local));
`);
  await writeFile(join(consumer, 'modules.mjs'), `
import assert from 'node:assert/strict';
import { Label as A, Message as Sender } from './definition.mjs?first';
import { Label as B, Message as Receiver } from './definition.mjs?second';
import { z } from 'zod';
const value = A.create('sample');
assert.equal(B.is(value), false);
assert.throws(() => B.read(value));
assert.throws(() => B.encode(value));
const decoded = B.create(JSON.parse(JSON.stringify(value)));
assert.equal(B.is(decoded), true);
assert.equal(A.is(decoded), false);
assert.equal(B.read(decoded), 'sample');
assert.throws(() => B.create('INVALID'));
const message = Sender.parse({ labels: ['sample'] });
assert.equal(Receiver.safeParse(message).success, false);
assert.equal(z.safeEncode(Receiver, message).success, false);
const wire = z.encode(Sender, message);
assert.equal(B.is(Receiver.parse(wire).labels[0]), true);
process.stdout.write(JSON.stringify(wire));
`);
  // Regression: independent definition executions and another process must reconstruct, not share private authority.
  const wire = run(process.execPath, ['modules.mjs'], consumer);
  assert.equal(run(process.execPath, ['receive.mjs'], consumer, wire), 'sample');
  assert.equal(run(process.execPath, ['receive.mjs', 'direct'], consumer, JSON.stringify('sample')), 'sample');
  await writeFile(join(consumer, 'codec.ts'), `
import { z } from 'zod';
import { defineSemantic } from '@bigbizze/semantic-values';

const a: unique symbol = Symbol('same');
const b: unique symbol = Symbol('same');
const options = { schema: z.string() };
const A = defineSemantic(a, options);
const B = defineSemantic(b, options);
const schema = z.object({ list: z.array(A.codec), optional: B.codec.optional().nullable() });
const local = schema.parse({ list: [A.encode(A.create('value'))], optional: null });
A.read(local.list[0]!);
// @ts-expect-error -- package emission must retain identical-data identity distinction
B.read(local.list[0]!);
const wire: z.input<typeof schema> = z.encode(schema, local);
const text: string = wire.list[0]!;
// @ts-expect-error -- encoded representation cannot masquerade as the semantic output
A.read(wire.list[0]!);
// @ts-expect-error -- typed wire data must not widen to any
const wrong: number = wire.list[0]!;
const countIdentity = Symbol('Count');
const Count = defineSemantic(countIdentity, { schema: z.codec(z.string(), z.number(), {
  decode: text => Number(text), encode: number => String(number),
}) });
const count = Count.create('3');
const native: number = Count.read(count);
const encoded: string = z.encode(Count.codec, count);
// @ts-expect-error -- native schema output and native wire retain distinct types
const incorrect: string = Count.read(count);
void [text, wrong, native, encoded, incorrect];
`);
  run(process.execPath, [compiler, '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2023', 'codec.ts'], consumer);
  await writeFile(join(consumer, 'codec.mjs'), `
import assert from 'node:assert/strict';
import { z } from 'zod';
import { defineSemantic } from '@bigbizze/semantic-values';

const Type = defineSemantic(Symbol('checked'), { schema: z.string().min(1) });
const schema = z.object({ values: z.array(Type.codec) });
const local = schema.parse({ values: [Type.encode(Type.create('value'))] });
assert.equal(Type.is(local.values[0]), true);
assert.equal(z.encode(schema, local).values[0], 'value');
const invalid = schema.safeParse({ values: [''] });
assert.equal(invalid.success, false);
assert.deepEqual(invalid.error.issues[0].path, ['values', 0]);
`);
  run(process.execPath, ['codec.mjs'], consumer);
  await writeFile(join(consumer, 'domain.ts'), `
import { defineSemantic } from '@bigbizze/semantic-values';
import { z } from 'zod';
const identity: unique symbol = Symbol('label');
export const Label = defineSemantic(identity, { schema: z.string() });
export type Label = ReturnType<typeof Label.create>;
`);
  await writeFile(join(consumer, 'schema.ts'), `
import { z } from 'zod';
import { Label } from './domain.js';
type Leaf = typeof Label.codec;
export const Composed: z.ZodObject<{ label: Leaf; labels: z.ZodArray<Leaf> }> = z.object({
  label: Label.codec, labels: z.array(Label.codec),
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
const text: string = wire.label;
// @ts-expect-error -- declarations of a composed schema must still distinguish handles from wire data
Label.read(wire.label);
void text;
`);
  run(process.execPath, [compiler, '--strict', '--noEmit', '--module', 'NodeNext', '--target', 'ES2023', 'public-consumer.ts'], consumer);
  // Regression: physically separate schema-library copies must retain Zod failure classification.
  await cp(join(consumer, 'node_modules/zod'), join(consumer, 'other-zod'), { recursive: true });
  await cp(join(consumer, 'node_modules/@bigbizze/semantic-values'), join(consumer, 'other-values'), { recursive: true });
  await writeFile(join(consumer, 'copies.mjs'), `
import assert from 'node:assert/strict';
import { z } from './other-zod/index.js';
import { defineSemantic } from './other-values/dist/index.js';
import { Label } from './definition.mjs';
const Other = defineSemantic(Symbol('other'), { schema: z.string().min(2) });
assert.equal(Other.codec.safeParse('x').success, false);
assert.equal(Other.read(Other.create('xx')), 'xx');
assert.equal(Other.is(Label.create('xx')), false);
assert.equal(Other.is(Other.create(Label.encode(Label.create('xx')))), true);
const bug = new Error('encoder bug');
const Broken = defineSemantic(Symbol('broken'), { schema: z.codec(z.string(), z.string(), {
  decode: x => x, encode: () => { throw bug; },
}) });
assert.throws(() => Broken.codec.safeParse('x'), error => error === bug);
const OneWay = defineSemantic(Symbol('one-way'), { schema: z.string().transform(x => x) });
assert.throws(() => OneWay.create('x'), /unidirectional transform/);
const Replay = defineSemantic(Symbol('replay'), { schema: z.codec(z.string(), z.string(), {
  decode: x => { if (x === 'wire') throw bug; return x; }, encode: () => 'wire',
}) });
assert.throws(() => Replay.codec.safeParse('x'), error => error === bug);
`);
  run(process.execPath, ['copies.mjs'], consumer);
  console.log('Packed exports, declarations, modules and process reconstruction passed.');
} finally { await rm(temporary, { recursive: true, force: true }); }
