import { z } from 'zod';
import * as core from 'zod/v4/core';
import { frozenCopy, SnapshotError, equalData, type PlainData } from './plain-data.js';

declare const nominal: unique symbol;
declare class Identity<T, Id extends symbol> { protected readonly [nominal]: readonly [T, Id]; }
export type Semantic<T, Id extends symbol> = Identity<T, Id>;
export type ReadonlyData<T> = { readonly [K in keyof T]: ReadonlyData<T[K]> };
export type SemanticCodec<Value, Wire> = z.ZodCodec<z.ZodCustom<Wire, Wire>, z.ZodCustom<Value, Value>>;
export interface SemanticDefinition<T, Wire, Id extends symbol> {
  readonly codec: SemanticCodec<Semantic<T, Id>, Wire>;
  create(input: unknown): Semantic<T, Id>;
  read(value: Semantic<T, Id>): ReadonlyData<T>;
  encode(value: Semantic<T, Id>): Wire;
  is(input: unknown): input is Semantic<T, Id>;
}

/** Synchronous schemas over bounded plain data. Codecs must preserve meaning on replay. */
export function defineSemantic<S extends core.$ZodType, Id extends symbol>(
  identity: symbol extends Id ? never : Id,
  options: { schema: S; sensitive?: boolean },
): SemanticDefinition<core.output<S>, core.input<S>, Id> {
  void identity;
  type Data = core.output<S>;
  type Wire = core.input<S>;
  type Value = Semantic<Data, Id>;
  const { schema, sensitive = false } = options;
  const members = new WeakMap<object, { data: ReadonlyData<Data>; wire: Wire }>();
  function is(value: unknown): value is Value {
    return typeof value === 'object' && value !== null && members.has(value);
  }
  function member(value: Value) {
    const retained = members.get(value);
    if (!retained) throw new TypeError('Expected local semantic value; encode with its owner, then reconstruct');
    return retained;
  }
  function encode(value: Value): Wire { return member(value).wire; }
  function read(value: Value): ReadonlyData<Data> { return member(value).data; }
  function toJSON(this: Value): Wire {
    const wire = encode(this);
    if (sensitive) throw new TypeError('Implicit JSON is disabled; call Type.encode(value) deliberately');
    return wire;
  }
  const prototype = Object.freeze(Object.create(null, { toJSON: { value: toJSON } }));
  function construct(input: unknown): Value {
    const source = frozenCopy(input);
    const parsed = core.parse(schema, source);
    // Invalid schema outputs and unstable encoders are definition errors, not invalid user input.
    let data: PlainData, wire: PlainData, replay: PlainData, reencoded: PlainData;
    try {
      data = frozenCopy(parsed);
      wire = frozenCopy(core.encode(schema, data as Data), true);
      replay = frozenCopy(core.parse(schema, wire));
      reencoded = frozenCopy(core.encode(schema, replay as Data), true);
    } catch (error) {
      if (!(error instanceof core.$ZodError || error instanceof SnapshotError)) throw error;
      throw new TypeError('Semantic schema must encode and reconstruct supported plain data');
    }
    if (!equalData(data, replay)) throw new TypeError('Semantic schema changes meaning on reconstruction');
    if (!equalData(wire, reencoded)) throw new TypeError('Semantic schema changes representation on reconstruction');
    const value = Object.freeze(Object.create(prototype)) as Value;
    members.set(value, { data: data as ReadonlyData<Data>, wire: wire as Wire });
    return value;
  }
  const codec: SemanticCodec<Value, Wire> = z.codec(
    z.custom<Wire>(), z.custom<Value>().check(context => {
      // Zod exposes codec.out publicly: it must authenticate without including rejected input.
      if (!is(context.value)) context.issues.push({
        code: 'custom', input: undefined, message: 'Expected local semantic value',
      });
    }), {
      decode(input, context) {
        try { return construct(input); }
        catch (error) {
          if (!(error instanceof core.$ZodError || error instanceof SnapshotError)) throw error;
          context.issues.push({ code: 'custom', input: undefined, message: 'Invalid semantic value' });
          return z.NEVER;
        }
      },
      encode(value, context) {
        // Refined unions can run reverse canaries without the output custom check.
        if (!is(value)) {
          context.issues.push({ code: 'custom', input: undefined, message: 'Expected local semantic value' });
          return z.NEVER;
        }
        return encode(value);
      },
    },
  );
  return Object.freeze({ codec, create: (input: unknown) => codec.parse(input), read, encode, is });
}
