import { z } from 'zod';
import * as core from 'zod/v4/core';
import { frozenCopy, SnapshotError, equalData, type PlainData } from './plain-data.js';
import type { ReadonlyData, SemanticCodec } from './semantic.js';

export function refusal(message = 'Invalid semantic value'): never {
  throw new z.ZodError([{ code: 'custom', path: [], message }]);
}
export function expected(error: unknown): boolean {
  return error instanceof core.$ZodError || error instanceof SnapshotError;
}
export function snapshotOutput(value: unknown): PlainData {
  try { return frozenCopy(value); }
  catch (error) {
    if (!(error instanceof SnapshotError)) throw error;
    throw new TypeError('Schema returned unsupported plain data');
  }
}
export function dataOf<S extends core.$ZodType>(schema: S, input: unknown): ReadonlyData<core.output<S>> {
  return snapshotOutput(core.parse(schema, frozenCopy(input))) as ReadonlyData<core.output<S>>;
}
export function stable<S extends core.$ZodType>(schema: S, input: unknown) {
  const data = dataOf(schema, input);
  let wire: PlainData, replay: PlainData, reencoded: PlainData;
  try {
    wire = frozenCopy(core.encode(schema, data as core.output<S>), true);
    replay = frozenCopy(core.parse(schema, wire));
    reencoded = frozenCopy(core.encode(schema, replay as core.output<S>), true);
  } catch (error) {
    if (!expected(error)) throw error;
    throw new TypeError('Semantic schema must encode and reconstruct supported plain data');
  }
  if (!equalData(data as PlainData, replay)) throw new TypeError('Semantic schema changes meaning on reconstruction');
  if (!equalData(wire, reencoded)) throw new TypeError('Semantic schema changes representation on reconstruction');
  return { data, wire: wire as core.input<S> };
}

export function verifiedSubject<S extends core.$ZodType>(schema: S, subject: ReadonlyData<core.output<S>>): ReadonlyData<core.output<S>> {
  const original = snapshotOutput(subject);
  const { data } = stable(schema, core.encode(schema, original as core.output<S>));
  if (!equalData(original, data as PlainData)) refusal('Verification must return the exact canonical subject');
  return data;
}

export function runtime<T, Value extends object, Wire>(portable: boolean, sensitive: boolean) {
  const members = new WeakMap<object, { data: ReadonlyData<T>; wire: Wire }>();
  function is(value: unknown): value is Value {
    return typeof value === 'object' && value !== null && members.has(value);
  }
  function member(value: Value) {
    const retained = members.get(value);
    if (!retained) throw new TypeError('Expected local semantic value');
    return retained;
  }
  function read(value: Value): ReadonlyData<T> { return member(value).data; }
  function encode(value: Value): Wire { return member(value).wire; }
  function toJSON(this: Value): Wire {
    const retained = member(this);
    if (!portable) throw new TypeError('Local-only semantic values cannot be serialized');
    if (sensitive) throw new TypeError('Implicit JSON is disabled; call Type.encode(value) deliberately');
    return retained.wire;
  }
  const prototype = Object.freeze(Object.create(null, { toJSON: { value: toJSON } }));
  const valueSchema = z.custom<Value>().check(context => {
    if (!is(context.value)) context.issues.push({ code: 'custom', input: undefined, message: 'Expected local semantic value' });
  });
  function issue(data: ReadonlyData<T>, wire: Wire): Value {
    const value = Object.freeze(Object.create(prototype)) as Value;
    members.set(value, { data, wire });
    return value;
  }
  function codec(construct: (input: unknown) => Value | Promise<Value>, asynchronous = false): SemanticCodec<Value, Wire> {
    const input = z.custom<Wire>();
    // Native Zod check stops sync parsing before any async verifier can start or reject.
    const guardedInput = asynchronous ? input.check(async () => {}) : input;
    return z.codec(guardedInput, valueSchema, {
      decode(input, context) {
        function invalid(error: unknown): never {
          if (!expected(error)) throw error;
          context.issues.push({ code: 'custom', input: undefined, message: 'Invalid semantic value' });
          return z.NEVER;
        }
        try {
          const result = construct(input);
          return result instanceof Promise ? result.catch(invalid) : result;
        } catch (error) { return invalid(error); }
      },
      encode(value, context) {
        // Refined-union canaries may skip output checks, so this guard is also required.
        if (!is(value)) {
          context.issues.push({ code: 'custom', input: undefined, message: 'Expected local semantic value' });
          return z.NEVER;
        }
        return encode(value);
      },
    });
  }
  return { issue, read, encode, is, valueSchema, codec };
}
