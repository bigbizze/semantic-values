import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { defineSemantic } from 'semantic-values';
import { reviewedDocument, CheckedRequest } from '../examples/process.ts';
import { DocumentSchema, EvidenceSchema, reviewService, type Document, type Evidence } from '../examples/process-domain.ts';
import { nativeReviewedDocument, NativeCheckedRequest } from '../examples/native-process.ts';

// Regression: a completed negative procedure, or data-only validation, must never issue a process value.
test('local establishment is explicit, once-only and immutable', async () => {
  let calls = 0, allowed = true;
  const identity = Symbol();
  const options = { kind: 'process' as const, schema: z.object({ text: z.string() }), establish: async (data: { readonly text: string }) => {
    calls++; return { ok: allowed && data.text === 'accept' };
  } };
  const Type = defineSemantic(identity, options);
  options.establish = async () => ({ ok: true });
  await assert.rejects(Type.establish({ text: 'reject' }), z.ZodError);
  assert.equal(calls, 1);
  const input = { text: 'accept' };
  const pending = Type.establish(input); input.text = 'changed';
  const value = await pending;
  assert.equal(calls, 2);
  assert.equal(Type.read(value).text, 'accept');
  assert.equal(calls, 2);
  allowed = false; // External state can change without changing the historical value.
  assert.equal(Type.read(value).text, 'accept');
  await assert.rejects(Type.establish({ text: 'accept' }), z.ZodError);
  assert.equal(calls, 3);
  assert.equal('create' in Type, false); assert.equal('codec' in Type, false); assert.equal('encode' in Type, false);
  assert.equal(Type.valueSchema.safeParse(input).success, false);
  assert.equal(z.object({ checked: Type.valueSchema }).parse({ checked: value }).checked, value);
  assert.throws(() => JSON.stringify(value), /Local-only/);
  for (const copy of [Object.create(Object.getPrototypeOf(value))]) {
    assert.equal(Type.is(copy), false); assert.throws(() => Type.read(copy as typeof value));
    assert.equal(Type.valueSchema.safeParse(copy).success, false);
  }
  const bad = defineSemantic(identity, { kind: 'process', schema: z.string(), establish: () => ({ ok: 'yes' } as never) });
  await assert.rejects(bad.establish('x'), TypeError);
  const bug = new Error('infrastructure failure');
  const broken = defineSemantic(identity, { kind: 'process', schema: z.string(), establish: () => { throw bug; } });
  await assert.rejects(broken.establish('x'), error => error === bug);
});

// Regression: both native and generic producers must bind one recorded event to its exact subject without replaying review.
test('generic and protected native classes enforce the same review boundary', async () => {
  async function exercise<Value extends object>(factory: (service: ReturnType<typeof reviewService>) => {
    establish(input: unknown): Promise<Value>; read(value: Value): Readonly<Document>; encode(value: Value): Evidence;
    is(input: unknown): boolean; codec: z.ZodType<Value, Evidence>;
  }) {
    const service = reviewService();
    const Sender = factory(service), Receiver = factory(service);
    service.verify = () => { throw new Error('replacement must not be used'); };
    const original = { title: 'A', body: 'accepted' };
    const pending = Sender.establish(original); original.body = 'altered';
    const value = await pending;
    assert.equal(service.calls, 1); assert.equal(Sender.read(value).body, 'accepted');
    const wire = Sender.encode(value);
    assert.equal(service.calls, 1); assert.equal(service.verifications, 1);
    assert.equal(Receiver.is(value), false); assert.throws(() => Receiver.read(value));
    assert.equal(Receiver.codec.safeParse(value).success, false);
    assert.equal(z.safeEncode(Receiver.codec, value).success, false);
    const local = Receiver.codec.parse(JSON.parse(JSON.stringify(value)));
    assert.equal(Receiver.is(local), true); assert.equal(service.calls, 1);
    for (const invalid of [{ ...wire, document: { title: 'B', body: 'accepted' } }]) {
      assert.equal(Receiver.codec.safeParse(invalid).success, false);
    }
    await assert.rejects(Sender.establish({ title: 'A', body: 'reject' }), z.ZodError);
    assert.equal(service.calls, 2);
    assert.throws(() => { (Sender.read(value) as { body: string }).body = 'mutated'; });
    for (const copy of [new Proxy(value, {})]) {
      assert.equal(Sender.is(copy), false); assert.throws(() => Sender.read(copy as Value));
      assert.equal(z.safeEncode(Sender.codec, copy as Value).success, false);
    }
    const forged = Object.create(Object.getPrototypeOf(value));
    assert.equal(Sender.is(forged), false); assert.throws(() => Sender.read(forged));
    const union = z.union([Sender.codec, z.literal('none')]).refine(() => true);
    assert.equal(z.safeEncode(union, forged).success, false);
    if (typeof Sender === 'function') assert.throws(() => Reflect.construct(Sender, [{}, original, wire]), /Private construction/);
  }
  await exercise(reviewedDocument); await exercise(nativeReviewedDocument);
  assert.throws(() => Reflect.construct(NativeCheckedRequest, [{}, { source: 'entry', text: 'x' }]), /Private construction/);
  for (const Type of [CheckedRequest, NativeCheckedRequest]) {
    const value = await Type.establish({ source: 'entry', text: 'x' });
    assert.equal(Type.is(value), true);
  }
});

// Regression: async evidence must compose with Zod and never turn synchronous misuse into an authenticated result.
test('async codecs, nested errors, sensitive encoding and trusted callback capture', async () => {
  const service = reviewService();
  const Type = reviewedDocument(service, true);
  const originalVerifier = service.verify;
  service.verify = () => { throw new Error('replacement must not be used'); };
  const initial = await Type.establish({ title: 'A', body: 'accepted' });
  const schema = z.object({ documents: z.array(Type.codec) });
  const wire = { documents: [Type.encode(initial)] };
  for (const value of [await schema.parseAsync(wire)]) {
    assert.ok(Type.is(value.documents[0]));
    assert.deepEqual(await z.encodeAsync(schema, value), wire);
  }
  const invalid = await schema.safeParseAsync({ documents: [{ ...wire.documents[0], event: 'private-invalid' }] });
  assert.equal(invalid.success, false);
  if (!invalid.success) { assert.deepEqual(invalid.error.issues[0]!.path, ['documents', 0]); assert.equal(JSON.stringify(invalid.error).includes('private-invalid'), false); }
  assert.equal(service.calls, 1);
  const identity = Symbol();
  service.verify = originalVerifier;
  const portable = { schema: EvidenceSchema, verify: service.verify };
  const Sensitive = defineSemantic(identity, { kind: 'process', schema: DocumentSchema, sensitive: true, establish: service.review, portable });
  const value = await Sensitive.establish({ title: 'A', body: 'accepted' });
  assert.throws(() => JSON.stringify({ value }), /Implicit JSON/);
  assert.deepEqual(z.encode(Sensitive.codec, value), Sensitive.encode(value));
  portable.verify = () => ({ ok: true, subject: { title: 'forged', body: 'forged' } });
  assert.equal(Sensitive.codec.safeParse({ ...Sensitive.encode(value), event: 'unknown' }).success, false);

});

// Regression: evidence for a different valid document must not be accepted during initial establishment.
test('initial evidence cannot substitute another subject', async () => {
  const service = reviewService();
  const other = await service.review({ title: 'Other', body: 'accepted' });
  const identity = Symbol();
  const Wrong = defineSemantic(identity, { kind: 'process', schema: DocumentSchema, establish: () => other, portable: { schema: EvidenceSchema, verify: service.verify } });
  await assert.rejects(Wrong.establish({ title: 'Intended', body: 'accepted' }), z.ZodError);
});

// Regression: validating a verifier's subject must not normalize it into a different, unreviewed subject.
test('verified native subject cannot be changed by the data schema', async () => {
  const identity = Symbol();
  const Type = defineSemantic(identity, {
    kind: 'process',
    schema: z.codec(z.string(), z.string(), { decode: text => text.toUpperCase(), encode: text => text }),
    establish: () => ({ ok: true, evidence: 'accepted-event' }),
    portable: { schema: z.string(), verify: () => ({ ok: true, subject: 'lowercase' }) },
  });
  assert.equal(Type.codec.safeParse('accepted-event').success, false);
  await assert.rejects(Type.establish('lowercase'), z.ZodError);
  const record = { title: 'A', body: 'approved' };
  const Mutable = defineSemantic(identity, { kind: 'process', schema: DocumentSchema,
    establish: () => ({ ok: true, evidence: 'event' }), portable: { schema: z.string(), verify: () => ({ ok: true, subject: record }) },
  });
  const local = Mutable.codec.parse('event'); record.body = 'changed';
  assert.equal(Mutable.read(local).body, 'approved');
});

// Regression: a misspelled or omitted process discriminant must not expose the weaker data constructor.
test('invalid construction configuration fails closed', () => {
  const id = Symbol();
  for (const options of [
    { kind: 'proces', schema: z.string(), establish: () => ({ ok: false }) },
    { schema: z.string(), establish: () => ({ ok: false }) },
    { kind: 'data', schema: z.string(), portable: {} },
  ]) assert.throws(() => defineSemantic(id, options as never), TypeError);
});

// Regression: sync API misuse must not launch a rejecting verifier or leave an abandoned rejection chain.
test('async guard prevents abandoned rejection and accepts foreign-realm promises', async () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { z } from 'zod';
    import { defineSemantic } from 'semantic-values';
    let calls = 0;
    const Type = defineSemantic(Symbol(), { kind: 'process', schema: z.string(), establish: () => ({ ok: true, evidence: 'event' }),
      portable: { schema: z.string(), async: true, verify: async () => { calls++; await Promise.resolve(); throw new Error('late failure'); } },
    });
    const schemas = [[Type.codec, 'event'], [z.object({ item: Type.codec }), { item: 'event' }]];
    for (const [schema, input] of schemas) {
      assert.throws(() => schema.parse(input), /async|Promise/i);
      assert.throws(() => schema.safeParse(input), /async|Promise/i);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls, 0);
    await assert.rejects(Type.codec.parseAsync('event'), /late failure/);
    assert.equal(calls, 1);
    const MissingFlag = defineSemantic(Symbol(), { kind: 'process', schema: z.string(), establish: () => ({ ok: true, evidence: 'event' }),
      portable: { schema: z.string(), verify: async () => { await Promise.resolve(); throw new Error('observed failure'); } },
    });
    assert.throws(() => MissingFlag.codec.parse('event'), /portable.async/);
    await new Promise(resolve => setTimeout(resolve, 10));
  `], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
  const id = Symbol();
  const foreign = runInNewContext('Promise.resolve({ ok: true, subject: "accepted" })') as Promise<{ ok: true; subject: string }>;
  const Type = defineSemantic(id, { kind: 'process', schema: z.string(), establish: () => ({ ok: true, evidence: 'event' }),
    portable: { schema: z.string(), async: true, verify: () => foreign },
  });
  assert.equal(Type.read(await Type.codec.parseAsync('event')), 'accepted');
  const broken = defineSemantic(id, { kind: 'process', schema: z.string(), establish: () => ({ ok: true, evidence: 'event' }),
    portable: { schema: z.string(), async: true, verify: () => runInNewContext('Promise.reject(new Error("foreign failure"))') as Promise<never> },
  });
  await assert.rejects(broken.codec.safeParseAsync('event'), /foreign failure/);
});
