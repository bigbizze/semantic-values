import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineSemantic } from '@bigbizze/semantic-values';
import { Identifier, DependencyGraph, SensitiveText } from '../examples/domains.ts';
const graphInput = () => ({ nodes: [
  { id: 'base', dependencies: [] as string[] }, { id: 'assembly', dependencies: ['base'] },
] });

// Regression: validation must precede issuance on both construction paths, without repeating it at consumption.
test('construction and versioned reconstruction enforce the receiving predicate', () => {
  const id = Symbol('validated');
  let calls = 0;
  const Type = defineSemantic(id, { contract: 'example.checked', version: 1, parse(input) {
    calls++;
    if (input !== 'accepted') throw new TypeError('Rejected');
    return input;
  } });
  const value = Type.create('accepted');
  Type.read(value); Type.encode(value); JSON.stringify(value);
  assert.equal(calls, 1);
  const wire = JSON.parse(JSON.stringify(value));
  assert.equal(Type.is(wire), false);
  assert.equal(Type.is(Type.decode(wire)), true);
  for (const change of [{ contract: 'other' }, { version: 2 }, { extra: true }, { data: 'rejected' }]) {
    assert.throws(() => Type.decode({ ...wire, ...change }));
  }
  assert.throws(() => Type.create('rejected'));
  const disguised = Object.defineProperties({ contract: 'example.checked', 'data,version': null }, {
    data: { value: 'accepted' }, version: { value: 1 },
  });
  assert.throws(() => Type.decode(disguised), 'Comma-containing keys must not hide missing enumerable fields');
  const duplicate = defineSemantic(id, { contract: 'example.checked', version: 1, parse: () => 'accepted' });
  assert.equal(duplicate.is(value), false);
  assert.throws(() => duplicate.read(value));
});

// Regression: input, parser-output and encoded-result aliases must not change established graph invariants.
test('immutable snapshots retain graph meaning and reject invalid references', () => {
  const input = graphInput();
  const value = DependencyGraph.create(input);
  const before = JSON.stringify(value);
  input.nodes[0]!.dependencies.push('missing');
  assert.equal(JSON.stringify(value), before);
  assert.throws(() => Object.assign(DependencyGraph.read(value).nodes[0]!, { id: 'changed' }));
  assert.throws(() => Object.assign(DependencyGraph.encode(value).data.nodes[0]!.dependencies, { 0: 'missing' }));
  for (const invalid of [
    { nodes: [{ id: 'base', dependencies: ['missing'] }] },
    { nodes: [{ id: 'base', dependencies: ['assembly'] }, { id: 'assembly', dependencies: ['base'] }] },
    { nodes: [{ id: 'base', dependencies: [] }, { id: 'base', dependencies: [] }] },
  ]) assert.throws(() => DependencyGraph.create(invalid));
  const id = Symbol('alias');
  const retained = { entries: [1] };
  const options = { contract: 'example.alias', version: 1, parse: () => retained };
  const Alias = defineSemantic(id, options);
  const issued = Alias.create(null);
  retained.entries.push(2);
  options.version = 2;
  options.parse = () => ({ entries: [3] });
  assert.deepEqual(Alias.read(issued), { entries: [1] });
  assert.equal(Alias.encode(Alias.create(null)).version, 1);
});

// Regression: static copy signatures, proxies and borrowed serializers must not grant access to private data.
test('opaque handles authenticate all consumption paths', () => {
  const ordinary = Identifier.create(' BLUE_WIDGET ');
  const sensitive = SensitiveText.create('demonstration-only');
  for (const [Type, value] of [[Identifier, ordinary], [SensitiveText, sensitive]] as const) {
    const serialize = Reflect.get(value, 'toJSON');
    assert.equal(Reflect.get(value, 'data'), undefined);
    assert.equal(Reflect.get(value, 'representation'), undefined);
    assert.deepEqual(Object.keys(value), []);
    for (const fake of [{}, { data: 'fake' }, { ...value }, Object.assign({}, value), structuredClone(value),
      Object.create(Object.getPrototypeOf(value)), new Proxy(value, {}), null, 0]) {
      assert.equal(Type.is(fake), false);
      assert.throws(() => Type.read(fake as never), /Expected local/);
      assert.throws(() => Type.encode(fake as never), /Expected local/);
      assert.throws(() => Reflect.apply(serialize, fake, []), /Expected local/);
    }
    assert.throws(() => Reflect.apply(serialize, value === ordinary ? sensitive : ordinary, []), /Expected local/);
    assert.throws(() => JSON.stringify(new Proxy(value, {})), /Expected local/);
  }
});

// Regression: automatic compound JSON must use checked representations, while sensitivity remains an implicit-only policy.
test('ordinary and sensitive serialization keep their distinct policies', () => {
  const value = Identifier.create(' BLUE_WIDGET ');
  const graph = DependencyGraph.create(graphInput());
  const message = JSON.parse(JSON.stringify({ value, list: [graph, value] }));
  assert.deepEqual(message, { value: Identifier.encode(value), list: [DependencyGraph.encode(graph), Identifier.encode(value)] });
  assert.equal(Identifier.read(Identifier.decode(message.value)), 'blue_widget');
  assert.equal(JSON.stringify(value), JSON.stringify(Identifier.encode(value)));
  const secret = SensitiveText.create('demonstration-only');
  for (const container of [secret, { secret }, [secret], { nested: [{ secret }] }]) {
    assert.throws(() => JSON.stringify(container), (error: unknown) => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, /sensitive.*encode/);
      assert.ok(!error.message.includes('demonstration-only'));
      return true;
    });
  }
  assert.equal(SensitiveText.read(secret), 'demonstration-only');
  assert.equal(SensitiveText.is(SensitiveText.decode(JSON.parse(JSON.stringify(SensitiveText.encode(secret))))), true);
  const id = Symbol('policy');
  const options = { contract: 'example.policy', version: 1, sensitive: true, parse: () => 'text' };
  const Type = defineSemantic(id, options);
  options.sensitive = false;
  assert.throws(() => JSON.stringify(Type.create(null)), /sensitive/);
  assert.ok(JSON.stringify({ data: SensitiveText.encode(secret) }).includes('demonstration-only'));
});

// Regression: unsupported graphs, opaque children and parser output aliases must not become silently accepted plain data.
test('plain-data boundary rejects unsupported values and snapshots before parser execution', () => {
  const id = Symbol('plain');
  let calls = 0;
  const Type = defineSemantic(id, { contract: 'example.plain', version: 1, parse: () => { calls++; return {}; } });
  const cycle: { next?: unknown } = {}; cycle.next = cycle;
  for (const input of [NaN, Infinity, undefined, new Date(), new Map(), cycle, { child: Identifier.create('valid') }]) {
    assert.throws(() => Type.create(input));
  }
  assert.equal(calls, 0);
  const mutable = { entries: [1] };
  const other = Symbol('snapshot');
  const Snapshot = defineSemantic(other, { contract: 'example.snapshot', version: 1, parse(input) {
    mutable.entries.push(2);
    assert.deepEqual(input, { entries: [1] });
    return { checked: true };
  } });
  assert.equal(Snapshot.read(Snapshot.create(mutable)).checked, true);
});

// Regression: the portable envelope must not consume the data's supported nesting depth on reconstruction.
test('data at the depth limit round-trips while deeper data is refused', () => {
  type Nested = number | Nested[];
  function parse(input: unknown): Nested {
    if (typeof input === 'number') return input;
    if (Array.isArray(input)) return input.map(parse);
    throw new TypeError('Expected nested numeric arrays');
  }
  const identity = Symbol('nested');
  const NestedValue = defineSemantic(identity, { contract: 'example.nested', version: 1, parse });
  let input: Nested = 1;
  for (let depth = 0; depth < 128; depth++) input = [input];
  const value = NestedValue.create(input);
  assert.equal(JSON.stringify(NestedValue.decode(JSON.parse(JSON.stringify(value)))), JSON.stringify(value));
  assert.throws(() => NestedValue.create([input]), RangeError);
  assert.throws(() => NestedValue.decode({ contract: 'example.nested', version: 1, data: [input] }), RangeError);
});
