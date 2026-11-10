// Detached immutable snapshots of finite JSON-like data, with a maximum depth of 128.
// Enumerable string keys are retained. Getters run during copying; symbols are omitted.
export type PlainData = null | boolean | number | string | readonly PlainData[] | PlainObject;
export type PlainObject = { readonly [key: string]: PlainData };

export function frozenCopy<T extends PlainData>(value: T): T {
  return copy(value) as T;
}

function copy(value: unknown, depth = 0): PlainData {
  if (depth > 128) throw new RangeError('Plain data exceeds 128 levels.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Plain data has finite numbers only.');
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(Array.from(value, (item) => copy(item, depth + 1)));
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, PlainData> = {};
      for (const key of Object.keys(value)) {
        Object.defineProperty(out, key, {
          value: copy((value as Record<string, unknown>)[key], depth + 1), enumerable: true,
        });
      }
      return Object.freeze(out);
    }
  }
  throw new TypeError(`Not plain data: ${Object.prototype.toString.call(value)}`);
}
