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
  // Reject accidental source, configuration, logs or source maps without fixing private module names.
  assert.ok(packed.files.every(({ path }) =>
    ['README.md', 'LICENSE', 'docs/API.md', 'package.json'].includes(path) || /^dist\/[a-z-]+\.(?:js|d\.ts)$/.test(path)));
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const zodPackage = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], fileURLToPath(new URL('../node_modules/zod/', import.meta.url))))[0];
  run('npm', ['install', '--ignore-scripts', '--package-lock=false', '--offline', '--no-audit', '--no-fund', join(temporary, packed.filename), join(temporary, zodPackage.filename)], consumer);

  await writeFile(join(consumer, 'codec.ts'), `
import { z } from 'zod';
import { defineSemantic } from 'semantic-values';

const a: unique symbol = Symbol('same');
const b: unique symbol = Symbol('same');
const options = { schema: z.string() };
const A = defineSemantic(a, options);
const B = defineSemantic(b, options);
const value = A.create('value');
// @ts-expect-error -- ordinary objects cannot substitute through emitted declarations
A.encode({});
// @ts-expect-error -- public data must not appear in emitted declarations
value.data;
const Numeric = defineSemantic(a, { schema: z.number() });
// @ts-expect-error -- declaration emission must retain generic data distinctions
Numeric.read(value);
// @ts-expect-error -- source subpaths are not package exports
import 'semantic-values/src/semantic.js';
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
  run(process.execPath, [compiler, '--noEmit', '--strict', '--noUncheckedSideEffectImports', '--module', 'NodeNext', '--target', 'ES2023', 'codec.ts'], consumer);
  // Regression: physically separate schema-library copies must retain Zod failure classification.
  await cp(join(consumer, 'node_modules/zod'), join(consumer, 'other-zod'), { recursive: true });
  await writeFile(join(consumer, 'copies.mjs'), `
import assert from 'node:assert/strict';
import { z } from './other-zod/index.js';
import { defineSemantic } from 'semantic-values';
const Other = defineSemantic(Symbol('other'), { schema: z.string().min(2) });
assert.equal(Other.codec.safeParse('x').success, false);
assert.equal(Other.read(Other.create('xx')), 'xx');
`);
  run(process.execPath, ['copies.mjs'], consumer);
  // Regression: mode-specific APIs and nominal identities must survive exported package declarations.
  await writeFile(join(consumer, 'process-domain.ts'), `
import { z } from 'zod';
import { defineSemantic } from 'semantic-values';
// Regression: authenticated readonly evidence can supply a structured subject without a mutable copy.
const structuredIdentity = Symbol('Structured');
const subject = z.object({ entries: z.array(z.string()) });
export const Structured = defineSemantic(structuredIdentity, {
  kind: 'process', schema: subject,
  establish: data => ({ ok: true, evidence: { entries: [...data.entries] } }),
  portable: { schema: subject, verify: evidence => ({ ok: true, subject: evidence }) },
});
const shared = Symbol('same');
export const Data = defineSemantic(shared, { kind: 'data', schema: z.string() });
export const Local = defineSemantic(shared, { kind: 'process', schema: z.string(), establish: text => ({ ok: text.length > 0 }) });
const reviewed = Symbol('Reviewed');
let establishments = 0, verifications = 0;
// A synthetic retained event is trusted by the application, not by the received representation.
const retained = Object.freeze({ event: 'review-event', claim: 'reviewed', text: 'accepted' });
export const Reviewed = defineSemantic(reviewed, {
  kind: 'process', schema: z.string(),
  establish(text) { establishments++; return text === retained.text ? { ok: true, evidence: retained } : { ok: false }; },
  portable: {
    schema: z.object({ event: z.string(), claim: z.string(), text: z.string() }).strict(), async: true,
    async verify(wire) {
      verifications++;
      return wire.event === retained.event && wire.claim === retained.claim && wire.text === retained.text
        ? { ok: true, subject: retained.text } : { ok: false };
    },
  },
});
export const counts = () => ({ establishments, verifications });
export const Message: z.ZodObject<{ document: typeof Reviewed.codec }> = z.object({ document: Reviewed.codec });
export type ReviewedValue = Awaited<ReturnType<typeof Reviewed.establish>>;
`);
  run(process.execPath, [compiler, '--strict', '--declaration', '--outDir', 'public-process', '--module', 'NodeNext', '--target', 'ES2023', 'process-domain.ts'], consumer);
  await writeFile(join(consumer, 'process-types.ts'), `
import { z } from 'zod';
import { Data, Local, Reviewed, Message, type ReviewedValue } from './public-process/process-domain.js';
const value = await Local.establish('accepted');
// @ts-expect-error -- data and process modes differ even if identity and output data match
Data.read(value);
// @ts-expect-error -- process construction must not expose data-only creation
Local.create('accepted');
// @ts-expect-error -- local process values have no restoration codec
Local.codec.parse('accepted');
// @ts-expect-error -- local process values have no encoder
Local.encode(value);
// @ts-expect-error -- portable process values must not expose data-only creation
Reviewed.create('accepted');
// @ts-expect-error -- data mode must not expose a designated process operation
Data.establish('accepted');
// @ts-expect-error -- a structural lookalike is not a process value
Local.read({});
const decoded: z.output<typeof Message> = await Message.parseAsync({ document: { event: 'review-event', claim: 'reviewed', text: 'accepted' } });
const nominal: ReviewedValue = decoded.document;
const wire: z.input<typeof Message> = await z.encodeAsync(Message, decoded);
const text: string = wire.document.text;
// @ts-expect-error -- portable wire is not a nominal reviewed value
Reviewed.read(wire.document);
void [nominal, text];
`);
  run(process.execPath, [compiler, '--strict', '--noEmit', '--module', 'NodeNext', '--target', 'ES2023', 'process-types.ts'], consumer);
  await writeFile(join(consumer, 'process-modules.mjs'), `
import assert from 'node:assert/strict';
import { z } from 'zod';
import * as A from './public-process/process-domain.js?sender';
import * as B from './public-process/process-domain.js?receiver';
const original = await A.Reviewed.establish('accepted');
const local = await B.Message.parseAsync({ document: A.Reviewed.encode(original) });
assert.equal(B.Reviewed.is(original), false);
assert.equal(B.Reviewed.is(local.document), true);
assert.deepEqual(A.counts(), { establishments: 1, verifications: 1 });
assert.deepEqual(B.counts(), { establishments: 0, verifications: 1 });
assert.equal((await B.Message.safeParseAsync({ document: original })).success, false);
assert.equal((await z.safeEncodeAsync(B.Message, { document: original })).success, false);
process.stdout.write(JSON.stringify(await z.encodeAsync(A.Message, { document: original })));
`);
  await writeFile(join(consumer, 'process-receive.mjs'), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Reviewed, Message, counts } from './public-process/process-domain.js';
const local = await Message.parseAsync(JSON.parse(readFileSync(0, 'utf8')));
assert.equal(Reviewed.is(local.document), true);
assert.deepEqual(counts(), { establishments: 0, verifications: 1 });
process.stdout.write(Reviewed.read(local.document));
`);
  const processWire = run(process.execPath, ['process-modules.mjs'], consumer);
  assert.equal(run(process.execPath, ['process-receive.mjs'], consumer, processWire), 'accepted');
  console.log('Packed exports, declarations, modules and process reconstruction passed.');
} finally { await rm(temporary, { recursive: true, force: true }); }
