import { SemanticValidationError } from './errors.js';
import { frozenCopy, type PlainData } from './plain-data.js';

declare const nominal: unique symbol;
// Protected symbol typing survives declaration emission without exposing a public data property.
declare class Identity<T, Id extends symbol> { protected readonly [nominal]: readonly [T, Id]; }
export type ReadonlyData<T> = { readonly [K in keyof T]: ReadonlyData<T[K]> };
export type Representation<T> = Readonly<{ contract: string; version: number; data: T }>;
export type Semantic<T, Id extends symbol> = Identity<T, Id>;

// Parsers are trusted, receiver-free callbacks over bounded plain data.
// Membership records local construction; it does not prove parser correctness or purity.
export function defineSemantic<T extends PlainData, Id extends symbol>(
  identity: symbol extends Id ? never : Id,
  options: { contract: string; version: number; sensitive?: boolean; parse(this: void, input: unknown): T },
) {
  void identity;
  const { contract, version, parse, sensitive = false } = options;
  if (!contract.trim() || !Number.isSafeInteger(version) || version < 1) throw new TypeError('Invalid contract');
  const members = new WeakMap<object, Representation<ReadonlyData<T>>>();
  type Value = Semantic<T, Id>;
  function is(value: unknown): value is Value {
    return typeof value === 'object' && value !== null && members.has(value);
  }
  function encode(value: Value): Representation<ReadonlyData<T>> {
    const wire = members.get(value);
    if (!wire) throw new TypeError(`Expected local ${contract}@${version}; encode with its owner, then decode`);
    return wire;
  }
  function read(value: Value): ReadonlyData<T> { return encode(value).data; }
  function toJSON(this: Value): Representation<ReadonlyData<T>> {
    const wire = encode(this);
    if (sensitive) throw new TypeError('Implicit JSON is disabled for sensitive values; call Type.encode(value) deliberately');
    return wire;
  }
  const prototype = Object.freeze(Object.create(null, { toJSON: { value: toJSON } }));
  function create(input: unknown): Value {
    // Snapshot before validation: getters and caller aliases cannot change what the validator sees.
    const parsed = parse(frozenCopy(input as PlainData));
    let data: T;
    try { data = frozenCopy(parsed); }
    catch { throw new TypeError('Parser returned unsupported plain data'); }
    const representation = Object.freeze({ contract, version, data });
    const value = Object.freeze(Object.create(prototype)) as Value;
    members.set(value, representation as Representation<ReadonlyData<T>>);
    return value;
  }
  function decode(input: unknown): Value {
    if (typeof input !== 'object' || input === null || Array.isArray(input)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
      || Object.keys(input).length !== 3 || Object.keys(input).sort().join(',') !== 'contract,data,version') {
      throw new SemanticValidationError(`Incompatible representation for ${contract}@${version}`);
    }
    // Inspect metadata once; create snapshots the data with its full depth allowance.
    const { contract: receivedContract, version: receivedVersion, data } = input as Record<string, unknown>;
    if (receivedContract !== contract || receivedVersion !== version) {
      throw new SemanticValidationError(`Incompatible representation for ${contract}@${version}`);
    }
    return create(data);
  }
  return Object.freeze({ create, decode, encode, is, read });
}
