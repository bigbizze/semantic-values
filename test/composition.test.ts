import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { defineSemantic } from '@bigbizze/semantic-values';
import { semanticCodec } from '@bigbizze/semantic-values/zod';
import { Identifier, DependencyGraph, SensitiveText } from '../examples/domains.ts';
import { Message, ManualSku, Sku, BundleFields, Bundle, readBundle } from '../examples/composition.ts';
import { messageWire } from './composition-fixture.ts';

// Regression: codec callbacks do not catch thrown exceptions, so programmer failures must still escape safe APIs.
test('raw codec throws through safeParse; adapter distinguishes declared validation from programmer errors', () => {
  for (const Failure of [TypeError, RangeError, Error]) {
    const identity = Symbol('failure');
    const Type = defineSemantic(identity, { contract: 'example.failure', version: 1, parse(): null { throw new Failure('Programmer failure'); } });
    const raw = z.codec(z.custom<ReturnType<typeof Type.encode>>(), z.custom<ReturnType<typeof Type.create>>(Type.is), { decode: Type.decode, encode: Type.encode });
    const wire = { contract: 'example.failure', version: 1, data: null };
    const adapted = semanticCodec(Type);
    for (const schema of [raw, adapted]) {
      for (const action of [() => schema.parse(wire), () => schema.safeParse(wire), () => z.decode(schema, wire), () => z.safeDecode(schema, wire)]) {
        assert.throws(action, /Programmer failure/);
      }
    }
  }
  const badOutputIdentity = Symbol('bad-output');
  const BadOutput = defineSemantic(badOutputIdentity, { contract: 'example.output', version: 1, parse: () => new Date() as unknown as string });
  assert.throws(() => semanticCodec(BadOutput).safeParse({ contract: 'example.output', version: 1, data: null }), /Parser returned unsupported/);
  const input = messageWire().items[0]!;
  for (const codec of [ManualSku, semanticCodec(Sku)]) {
    assert.equal(Sku.read(codec.parse(input)), 'AB-123');
    assert.equal(codec.safeParse({ ...input, version: 2 }).success, false);
  }
});

// Regression: nested semantic errors must become located, redacted Zod issues without bypassing their authoritative decoders.
test('nested expected failures report schema paths through parse, safeParse, decode and safeDecode', () => {
  const schema = z.object({ payload: z.object({ rows: z.array(Message) }) });
  for (const [field, change, path] of [
    ['owner', { contract: 'wrong' }, ['payload', 'rows', 1, 'owner']],
    ['graph', { version: 2 }, ['payload', 'rows', 1, 'graph']],
    ['graph', { data: { nodes: [{ id: 'base', dependencies: ['missing'] }] } }, ['payload', 'rows', 1, 'graph']],
  ] as const) {
    const bad = messageWire();
    const input = { payload: { rows: [messageWire(), { ...bad, [field]: { ...bad[field], ...change } }] } };
    const safe = schema.safeParse(input);
    assert.equal(safe.success, false);
    if (!safe.success) assert.deepEqual(safe.error.issues[0]?.path, path);
    assert.equal(z.safeDecode(schema, input as z.input<typeof schema>).success, false);
    assert.throws(() => schema.parse(input), z.ZodError);
    assert.throws(() => z.decode(schema, input as z.input<typeof schema>), z.ZodError);
  }
  const input = messageWire();
  const result = Message.safeParse({ ...input, items: [...input.items, { ...input.items[0], data: 'do-not-repeat-this-input' }] }, { reportInput: true });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues[0]?.path, ['items', 1]);
    assert.ok(!JSON.stringify(result.error).includes('do-not-repeat-this-input'));
  }
  let tooDeep: unknown = 1;
  for (let i = 0; i < 129; i++) tooDeep = [tooDeep];
  assert.equal(semanticCodec(Sku).safeParse({ ...input.items[0], data: tooDeep }).success, false);
});

// Regression: Zod object/array/tuple/union traversal must retain local child identity in both directions and immutable child contents.
test('composed round trip is local, immutable at semantic leaves and equivalent to ordinary JSON for valid messages', () => {
  const wire = messageWire();
  const order = Message.parse(wire);
  assert.equal(Identifier.is(order.owner), true);
  assert.equal(Sku.is(order.items[0]), true);
  assert.equal(Sku.is(order.pair[1]), true);
  assert.equal(Sku.is(order.selected), true);
  const encoded = z.encode(Message, order);
  assert.deepEqual(JSON.parse(JSON.stringify(order)), JSON.parse(JSON.stringify(encoded)));
  assert.equal(DependencyGraph.is(encoded.graph), false);
  assert.equal(DependencyGraph.read(order.graph).nodes.length, 2);
  assert.throws(() => Object.assign(DependencyGraph.read(order.graph).nodes[0]!, { id: 'changed' }));
  const modified = JSON.parse(JSON.stringify(wire));
  const parsed = Message.parse(modified);
  modified.graph.data.nodes.length = 0;
  assert.equal(DependencyGraph.read(parsed.graph).nodes.length, 2);
  assert.equal(Message.parse({ ...wire, selected: wire.owner, note: undefined }).note, undefined);
  const missing = { ...wire }; delete (missing as Partial<typeof missing>).note;
  assert.equal(Message.parse(missing).note, undefined);
  for (const fake of [{}, Object.assign({}, order.items[0]), structuredClone(order.items[0]), new Proxy(order.items[0]!, {})]) {
    assert.equal(z.safeEncode(Message, { ...order, items: [fake] } as typeof order).success, false);
    assert.throws(() => z.encode(Message, { ...order, items: [fake] } as typeof order), z.ZodError);
  }
});

// Regression: explicit schema encoding may disclose sensitive children, while implicit JSON and failure diagnostics must not do so accidentally.
test('sensitive children preserve implicit refusal and explicit disclosure without propagating policy to plain data', () => {
  const note = SensitiveText.encode(SensitiveText.create('demonstration-only'));
  const order = Message.parse({ ...messageWire(), note });
  assert.throws(() => JSON.stringify(order), /sensitive/);
  assert.ok(JSON.stringify(z.encode(Message, order)).includes('demonstration-only'));
  const id = Symbol('sensitive-validation');
  const Secret = defineSemantic(id, { contract: 'example.hidden', version: 1, sensitive: true,
    parse: z.string().refine(() => false, 'Never print the submitted text: demonstration-only').parse });
  const result = z.object({ secret: semanticCodec(Secret) }).safeParse({ secret: { contract: 'example.hidden', version: 1, data: 'demonstration-only' } });
  assert.equal(result.success, false);
  if (!result.success) assert.ok(!JSON.stringify(result.error).includes('demonstration-only'));
  // Input reporting on a parent union is outside the leaf adapter's redaction boundary.
  const union = z.union([semanticCodec(Secret), semanticCodec(Sku)]);
  const reported = union.safeParse({ contract: 'example.hidden', version: 1, data: 'demonstration-only' }, { reportInput: true });
  assert.equal(reported.success, false);
  if (!reported.success) assert.ok(JSON.stringify(reported.error).includes('demonstration-only'));
});

// Regression: complete receiver-side definition copies must mint their own children rather than accepting sender handles.
test('independent modules and another process reconstruct composed messages', async () => {
  const directory = await mkdtemp(fileURLToPath(new URL('../.composition-', import.meta.url)));
  try {
    await cp(new URL('../examples/', import.meta.url), directory, { recursive: true });
    const receiver = await import(`${directory}/composition.ts`);
    const receiverDomains = await import(`${directory}/domains.ts`);
    const sender = Message.parse(messageWire());
    const wire = z.encode(Message, sender);
    assert.equal(receiver.Message.safeParse(sender).success, false);
    assert.equal(z.safeEncode(receiver.Message, sender).success, false);
    const local = receiver.Message.parse(wire);
    assert.equal(receiver.Sku.is(local.items[0]), true);
    assert.equal(receiverDomains.Identifier.is(local.owner), true);
    assert.equal(Sku.is(local.items[0]), false);
    assert.equal(Identifier.is(local.owner), false);
    assert.deepEqual(z.encode(receiver.Message, local), wire);
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./receive-composed.ts', import.meta.url))], {
      input: JSON.stringify(sender), encoding: 'utf8', timeout: 4000,
    });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { owner: true, item: true, graph: true });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

// Regression: validating each child does not establish the outer relation, and snapshotting must never pretend to retain child memberships.
test('outer semantic relation is enforced over verified child representations without changing the snapshot model', () => {
  const wire = messageWire();
  const valid = { owner: wire.owner, selected: wire.items[0], items: wire.items };
  const bundle = Bundle.create(valid);
  const children = readBundle(bundle);
  assert.equal(Sku.is(children.selected), true);
  assert.equal(Identifier.is(children.owner), true);
  assert.equal(Sku.is(Bundle.read(bundle).selected), false);
  assert.throws(() => Bundle.create({ ...valid, selected: Sku.encode(Sku.create('CD-456')) }), z.ZodError);
  assert.throws(() => Bundle.create({ ...valid, items: [...wire.items, ...wire.items] }), z.ZodError);
  assert.throws(() => Bundle.create(children), TypeError);
  assert.throws(() => z.encode(BundleFields, { ...children, selected: Sku.create('CD-456') }), z.ZodError);
  children.items.length = 0;
  assert.equal(readBundle(bundle).items.length, 1);
});

// Regression: reverse refinement canaries skip z.custom checks and must not throw while trying valid union branches.
test('refined leaves, unions and objects encode with local checks and located failures', () => {
  const union = z.union([semanticCodec(Identifier), semanticCodec(Sku)]).refine(() => true);
  for (const value of [Identifier.create('sample'), Sku.create('AB-123')]) {
    assert.equal(z.safeEncode(union, value).success, true);
  }
  const message = Message.parse(messageWire());
  assert.equal(z.safeEncode(Message.refine(() => true), message).success, true);
  const leaf = semanticCodec(Sku).refine(() => true);
  assert.equal(z.safeEncode(leaf, {} as ReturnType<typeof Sku.create>).success, false);
  const object = z.object({ item: union }).refine(() => true);
  const result = z.safeEncode(object, { item: {} } as z.output<typeof object>);
  assert.equal(result.success, false);
  if (!result.success) assert.deepEqual(result.error.issues[0]?.path, ['item']);
});

// Regression: output getters are programmer code even when they throw a recognized input-validation exception.
test('output-copy failures propagate while Zod Mini input failures are redacted', async () => {
  const mini = await import('zod/mini');
  const identity = Symbol('mini');
  const Type = defineSemantic(identity, { contract: 'mini', version: 1,
    parse: (input) => mini.parse(mini.string({ error: 'demonstration-only' }), input) });
  const result = semanticCodec(Type).safeParse({ contract: 'mini', version: 1, data: 123 });
  assert.equal(result.success, false);
  if (!result.success) assert.ok(!JSON.stringify(result.error).includes('demonstration-only'));
  const outputIdentity = Symbol('output-getter');
  const Broken = defineSemantic(outputIdentity, { contract: 'output', version: 1,
    parse: () => ({ get value() { return z.string().parse(123); } }) });
  assert.throws(() => semanticCodec(Broken).safeParse({ contract: 'output', version: 1, data: null }),
    (error) => error instanceof TypeError && error.message === 'Parser returned unsupported plain data');
});

// Regression: independently installed core error classes must participate in the same deliberate rejection protocol.
test('another physical core copy reports expected input and depth failures through safeParse', async () => {
  const directory = await mkdtemp(fileURLToPath(new URL('../.composition-', import.meta.url)));
  try {
    await cp(new URL('../dist/', import.meta.url), directory, { recursive: true });
    const other = await import(`${directory}/index.js`);
    const Type = other.defineSemantic(Symbol('copy'), { contract: 'copy', version: 1,
      parse() { throw new other.SemanticValidationError('demonstration-only'); } });
    const codec = semanticCodec(Type);
    for (const input of [null, { contract: 'copy', version: 1, data: 'invalid' }]) {
      const result = codec.safeParse(input);
      assert.equal(result.success, false);
      if (!result.success) assert.ok(!JSON.stringify(result.error).includes('demonstration-only'));
    }
    let deep: unknown = null;
    for (let i = 0; i < 129; i++) deep = [deep];
    assert.equal(codec.safeParse({ contract: 'copy', version: 1, data: deep }).success, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

// Regression: representation-only outer construction requires replayable child parsers, not merely valid initial children.
test('outer construction rechecks retained representations and example children are replay stable', () => {
  const identity = Symbol('one-way');
  const Child = defineSemantic(identity, { contract: 'one-way', version: 1,
    parse: z.string().startsWith('raw:').transform((text) => text.slice(4)).parse });
  const fields = z.object({ child: semanticCodec(Child) });
  const outerIdentity = Symbol('outer');
  const Outer = defineSemantic(outerIdentity, { contract: 'outer', version: 1, parse(input) {
    const wire = z.encode(fields, fields.parse(input));
    fields.parse(wire);
    return wire;
  } });
  assert.throws(() => Outer.create({ child: { contract: 'one-way', version: 1, data: 'raw:abc' } }), z.ZodError);
  const bundle = Bundle.create({ owner: messageWire().owner, selected: messageWire().items[0], items: messageWire().items });
  const first = Bundle.encode(bundle);
  assert.deepEqual(Bundle.encode(Bundle.decode(first)), first);
  assert.deepEqual(z.encode(BundleFields, readBundle(bundle)), Bundle.read(bundle));
});
