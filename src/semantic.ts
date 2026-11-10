import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { dataOf, expected, refusal, runtime, stable, verifiedSubject } from './runtime.js';
import { equalData, type PlainData } from './plain-data.js';

declare const nominal: unique symbol;
declare class Identity<T, Id extends symbol, Kind> { protected readonly [nominal]: readonly [T, Id, Kind]; }
export type Semantic<T, Id extends symbol, Kind = 'data'> = Identity<T, Id, Kind>;
export type ReadonlyData<T> = { readonly [K in keyof T]: ReadonlyData<T[K]> };
export type SemanticCodec<Value, Wire> = z.ZodCodec<z.ZodCustom<Wire, Wire>, z.ZodCustom<Value, Value>>;
type MaybePromise<T> = T | PromiseLike<T>;
export type Decision = { ok: true } | { ok: false };
export type EvidenceDecision<E> = { ok: true; evidence: E } | { ok: false };
export type Verification<S> = { ok: true; subject: ReadonlyData<S> } | { ok: false };
type Common<S extends core.$ZodType> = { schema: S; sensitive?: boolean };
export type DataOptions<S extends core.$ZodType> = Common<S> & { kind?: 'data' };
export type LocalOptions<S extends core.$ZodType> = Common<S> & {
  kind: 'process'; portable?: never;
  establish(data: ReadonlyData<core.output<S>>): MaybePromise<Decision>;
};
export type PortableOptions<S extends core.$ZodType, E extends core.$ZodType> = Common<S> & {
  kind: 'process';
  establish(data: ReadonlyData<core.output<S>>): MaybePromise<EvidenceDecision<core.input<E>>>;
  portable: {
    schema: E;
  } & (
    { async?: false; verify(evidence: ReadonlyData<core.output<E>>): Verification<core.output<S>> }
    | { async: true; verify(evidence: ReadonlyData<core.output<E>>): MaybePromise<Verification<core.output<S>>> }
  );
};
export interface SemanticDefinition<T, Wire, Id extends symbol> {
  readonly codec: SemanticCodec<Semantic<T, Id>, Wire>;
  create(input: unknown): Semantic<T, Id>;
  read(value: Semantic<T, Id>): ReadonlyData<T>;
  encode(value: Semantic<T, Id>): Wire;
  is(input: unknown): input is Semantic<T, Id>;
}
export interface ProcessDefinition<T, Id extends symbol> {
  establish(input: unknown): Promise<Semantic<T, Id, 'process'>>;
  read(value: Semantic<T, Id, 'process'>): ReadonlyData<T>;
  is(input: unknown): input is Semantic<T, Id, 'process'>;
  readonly valueSchema: z.ZodCustom<Semantic<T, Id, 'process'>, Semantic<T, Id, 'process'>>;
}
export interface PortableDefinition<T, Wire, Id extends symbol> extends ProcessDefinition<T, Id> {
  readonly codec: SemanticCodec<Semantic<T, Id, 'process'>, Wire>;
  encode(value: Semantic<T, Id, 'process'>): Wire;
}

export function defineSemantic<S extends core.$ZodType, Id extends symbol>(identity: symbol extends Id ? never : Id, options: DataOptions<S>): SemanticDefinition<core.output<S>, core.input<S>, Id>;
export function defineSemantic<S extends core.$ZodType, E extends core.$ZodType, Id extends symbol>(identity: symbol extends Id ? never : Id, options: PortableOptions<S, E>): PortableDefinition<core.output<S>, core.input<E>, Id>;
export function defineSemantic<S extends core.$ZodType, Id extends symbol>(identity: symbol extends Id ? never : Id, options: LocalOptions<S>): ProcessDefinition<core.output<S>, Id>;
export function defineSemantic<S extends core.$ZodType, E extends core.$ZodType, Id extends symbol>(
  identity: Id, options: DataOptions<S> | LocalOptions<S> | PortableOptions<S, E>,
) {
  void identity;
  const kind = options.kind;
  if (kind !== undefined && kind !== 'data' && kind !== 'process') throw new TypeError('Unknown semantic kind');
  if (kind === 'process') return processDefinition<S, E, Id>(options);
  if ('establish' in options || 'portable' in options) throw new TypeError('Process options require kind: process');
  const { schema, sensitive = false } = options;
  const values = runtime<core.output<S>, Semantic<core.output<S>, Id>, core.input<S>>(true, sensitive);
  const codec = values.codec(input => {
    const { data, wire } = stable(schema, input);
    return values.issue(data, wire);
  });
  return Object.freeze({ codec, create: (input: unknown) => codec.parse(input), read: values.read, encode: values.encode, is: values.is });
}

function succeeded<T extends Decision>(result: T): result is Extract<T, { ok: true }> {
  const ok = result?.ok;
  if (ok !== true && ok !== false) throw new TypeError('Process must return an explicit decision');
  return ok;
}
function processDefinition<S extends core.$ZodType, E extends core.$ZodType, Id extends symbol>(options: LocalOptions<S> | PortableOptions<S, E>) {
  const { schema, establish: procedure, sensitive = false, portable } = options;
  type Value = Semantic<core.output<S>, Id, 'process'>;
  const values = runtime<core.output<S>, Value, core.input<E>>(!!portable, sensitive);
  const access = { read: values.read, is: values.is, valueSchema: values.valueSchema };
  if (!portable) {
    return Object.freeze({ ...access, async establish(input: unknown): Promise<Value> {
      try {
        const data = dataOf(schema, input);
        if (!succeeded(await procedure(data))) refusal('Process refused');
        return values.issue(data, undefined as core.input<E>);
      } catch (error) { if (expected(error)) refusal(); throw error; }
    } });
  }
  // Capture trusted callbacks once; mutating the options object cannot replace them.
  const { schema: evidenceSchema, verify, async: asynchronous = false } = portable;
  function reconstruct(input: unknown) {
    const { data: evidence, wire } = stable(evidenceSchema, input);
    function verified(result: Verification<core.output<S>>) {
      if (!succeeded(result)) refusal('Evidence refused');
      const data = verifiedSubject(schema, result.subject);
      return { data, wire };
    }
    const result = verify(evidence);
    if (asynchronous) return (async () => verified(await result))();
    if (typeof (result as Partial<PromiseLike<unknown>>)?.then === 'function') {
      void Promise.resolve(result).catch(() => {});
      throw new TypeError('Async verification requires portable.async: true');
    }
    return verified(result as Verification<core.output<S>>);
  }
  const codec = values.codec(input => {
    const result = reconstruct(input);
    return result instanceof Promise ? result.then(({ data, wire }) => values.issue(data, wire)) : values.issue(result.data, result.wire);
  }, asynchronous);
  return Object.freeze({ ...access, codec, encode: values.encode, async establish(input: unknown): Promise<Value> {
    try {
      const data = dataOf(schema, input);
      const result = await procedure(data);
      if (!succeeded(result)) refusal('Process refused');
      if (!('evidence' in result)) throw new TypeError('Successful portable establishment must return evidence');
      const verified = await reconstruct(result.evidence);
      if (!equalData(data as PlainData, verified.data as PlainData)) refusal('Evidence subject differs from established subject');
      return values.issue(data, verified.wire);
    } catch (error) { if (expected(error)) refusal(); throw error; }
  } });
}
