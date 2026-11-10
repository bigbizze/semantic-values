import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import * as mini from 'zod/mini';
import { defineSemantic } from 'semantic-values';
import { Identifier, Sku, DependencyGraph, SensitiveText } from '../examples/domains.ts';
import { Order, Bundle, readBundle } from '../examples/composition.ts';

// Regression: native normalization and composed reconstruction must retain local membership and wire shapes.
test('native representations and nested schema composition', () => {
  const value = Order.parse({ owner: 'alice', items: ['ab-123', 'cd-456'] });
  assert.equal(Sku.read(value.items[0]!), 'AB-123');
  const wire = z.encode(Order, value);
  assert.deepEqual(wire, { owner: 'alice', items: ['AB-123', 'CD-456'] });
  assert.deepEqual(JSON.parse(JSON.stringify(value)), wire);
  assert.ok(Sku.is(Order.parse(wire).items[0]));
});

// Regression: TS-preserving copies, proxies and refined-union canaries must not bypass reverse membership checks.
test('copies and borrowed serialization cannot authenticate', () => {
  const value = Sku.create('ab-123');
  const borrowed = Object.getPrototypeOf(value).toJSON;
  const candidates = [structuredClone(value), new Proxy(value, {}),
    Object.create(Object.getPrototypeOf(value))];
  const refined = z.union([Sku.codec, Identifier.codec]).refine(() => true);
  for (const candidate of candidates) {
    assert.equal(Sku.is(candidate), false);
    assert.equal(Sku.codec.out.safeParse(candidate).success, false);
    assert.throws(() => Sku.read(candidate as typeof value));
    assert.throws(() => Sku.encode(candidate as typeof value));
    assert.throws(() => borrowed.call(candidate));
    assert.equal(z.safeEncode(refined, candidate as typeof value).success, false);
  }
  assert.equal(z.encode(refined, value), 'AB-123');
  assert.equal(Sku.codec.out.parse(value), value);
});

// Regression: input aliases, schema-output aliases and observations must not mutate retained meaning or encoding.
test('detached snapshots and structured invariants', () => {
  const input = { nodes: ['a', 'b'], edges: [['a', 'b']] };
  const graph = DependencyGraph.create(input);
  input.nodes.length = 0;
  assert.deepEqual(DependencyGraph.encode(graph), { nodes: ['a', 'b'], edges: [['a', 'b']] });
  assert.throws(() => (DependencyGraph.read(graph).nodes as string[]).push('x'));
  const alias = { list: ['a'] };
  const identity = Symbol();
  const type = defineSemantic(identity, { schema: z.codec(z.object({ list: z.array(z.string()) }),
    z.object({ list: z.array(z.string()) }), { decode: () => alias, encode: x => x }) });
  const minted = type.create(alias);
  alias.list.push('b');
  assert.deepEqual(type.read(minted), { list: ['a'] });
  assert.deepEqual(type.encode(minted), { list: ['a'] });
});

// Regression: invalid nested data must be Zod failures with useful outer paths and no schema-provided secrets.
test('error paths, redaction, Mini and programmer errors', () => {
  const id = Symbol();
  const Mini = defineSemantic(id, { schema: mini.string().check(mini.minLength(2)) });
  assert.equal(Mini.codec.safeParse('x').success, false);
  assert.equal(Mini.read(Mini.create('xx')), 'xx');
  const broken = defineSemantic(id, { schema: z.string().refine(() => { throw new Error('bug'); }) });
  assert.throws(() => broken.codec.safeParse('x'), /bug/);
  assert.throws(() => Sku.create({ get value() { throw new Error('getter bug'); } }), /getter bug/);
});

// Regression: one-way transforms, unsupported outputs and meaning-changing replay must never mint portable values.
test('encodability and replay are checked before minting', () => {
  const id = Symbol();
  const oneWay = defineSemantic(id, { schema: z.string().transform(x => x.toUpperCase()) });
  assert.throws(() => oneWay.create('abc'), /unidirectional transform/);
  const drift = defineSemantic(id, { schema: z.codec(z.number(), z.number(), { decode: x => x + 1, encode: x => x }) });
  assert.throws(() => drift.create(1), /changes meaning/);
  const unsupported = defineSemantic(id, { schema: z.codec(z.string(), z.date(), { decode: () => new Date(), encode: () => 'date' }) });
  assert.throws(() => unsupported.create('date'), /supported plain data/);
  const invalidWire = defineSemantic(id, { schema: z.codec(z.string().min(1), z.string(), { decode: x => x, encode: () => '' }) });
  assert.throws(() => invalidWire.create('x'), /encode and reconstruct/);
});

// Regression: explicit composition encoding may disclose sensitive children but implicit JSON must still refuse.
test('sensitive values and redacted failures', () => {
  const schema = z.object({ secret: SensitiveText.codec });
  const value = schema.parse({ secret: 'example-only' });
  assert.throws(() => JSON.stringify(value), /Implicit JSON is disabled/);
  assert.deepEqual(z.encode(schema, value), { secret: 'example-only' });
});

// Regression: retaining plain child wires must still establish the outer relation after canonicalization.
test('outer invariant checks canonical child meanings', () => {
  const bundle = Bundle.create({ selected: 'ab-123', items: ['ab-123', 'cd-456'] });
  assert.deepEqual(readBundle(bundle).items.map(Sku.read), ['AB-123', 'CD-456']);
  assert.throws(() => Bundle.create({ selected: 'ab-123', items: ['ab-123', 'AB-123'] }), z.ZodError);
});

// Regression: output custom checks must not attach rejected sensitive inputs even when reporting input is requested.
test('Zod errors keep semantic leaf input redacted', () => {
  const invalid = 'example-private';
  const schema = z.object({ nested: z.array(SensitiveText.codec) });
  const nested = z.safeEncode(schema, { nested: [invalid as never] }, { reportInput: true });
  const decoded = z.safeDecode(z.object({ nested: z.array(Sku.codec) }), { nested: [invalid] }, { reportInput: true });
  const output = SensitiveText.codec.out.safeParse(invalid, { reportInput: true });
  for (const result of [nested, decoded, output]) {
    assert.equal(result.success, false);
    if (!result.success) assert.equal(JSON.stringify(result.error).includes(invalid), false);
  }
  if (!nested.success) assert.deepEqual(nested.error.issues[0]!.path, ['nested', 0]);
  if (!decoded.success) assert.deepEqual(decoded.error.issues[0]!.path, ['nested', 0]);
});

// Regression: snapshots must use array indices, not an iterator that substitutes different validation input.
test('array snapshots ignore overridden iterators', () => {
  const id = Symbol();
  const type = defineSemantic(id, { schema: z.array(z.literal('accepted')) });
  const input = ['rejected'];
  input[Symbol.iterator] = () => ['accepted'].values();
  assert.equal(type.codec.safeParse(input).success, false);
});

// Regression: signed zero needs a lossless application wire, and key-order-sensitive encoders must stabilize.
test('JSON number loss and unstable canonical encoding cannot mint', () => {
  const id = Symbol();
  const negative = defineSemantic(id, { schema: z.number().refine(x => Object.is(x, -0)) });
  assert.throws(() => negative.create(-0), /supported plain data/);
  const lossless = defineSemantic(id, { schema: z.codec(z.literal('-0'), z.number(), {
    decode: () => -0, encode: () => '-0' as const,
  }) });
  const value = lossless.create('-0');
  assert.ok(Object.is(lossless.read(lossless.create(JSON.parse(JSON.stringify(value)))), -0));
  const changed = defineSemantic(id, { schema: z.codec(z.string(), z.number(), {
    decode: text => text === 'negative' ? -0 : 0, encode: () => 'positive',
  }) });
  assert.throws(() => changed.create('negative'), /changes meaning/);
  const reordered = defineSemantic(id, { schema: z.codec(z.string(), z.record(z.string(), z.number()), {
    decode: text => text === 'ab' ? { b: 1, a: 1 } : { a: 1, b: 1 },
    encode: record => Object.keys(record).join(''),
  }) });
  assert.throws(() => reordered.create('ab'), /changes representation/);
});

// Regression: callback bugs during reverse encoding and replay must preserve the original exception.
test('encoder and replay programmer exceptions propagate', () => {
  const id = Symbol();
  const bug = new Error('callback bug');
  const encoder = defineSemantic(id, { schema: z.codec(z.string(), z.string(), {
    decode: x => x, encode: () => { throw bug; },
  }) });
  assert.throws(() => encoder.codec.safeParse('x'), error => error === bug);
  const replay = defineSemantic(id, { schema: z.codec(z.string(), z.string(), {
    decode: text => { if (text === 'wire') throw bug; return text; }, encode: () => 'wire',
  }) });
  assert.throws(() => replay.codec.safeParse('x'), error => error === bug);
});
