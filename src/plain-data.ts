export class SnapshotError extends Error {}
// Detached immutable snapshots of finite JSON-like data, with a maximum depth of 128.
// Records retain enumerable string keys; arrays retain indexed slots only. Getters run; symbols are omitted.
export type PlainData = null | boolean | number | string | readonly PlainData[] | PlainObject;
export type PlainObject = { readonly [key: string]: PlainData };

export function frozenCopy(value: unknown, jsonWire = false): PlainData {
  return copy(value, 0, jsonWire);
}

function copy(value: unknown, depth: number, jsonWire: boolean): PlainData {
  if (depth > 128) throw new SnapshotError('Plain data exceeds 128 levels.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new SnapshotError('Plain data has finite numbers only.');
    if (jsonWire && Object.is(value, -0)) throw new SnapshotError('JSON wire cannot preserve negative zero.');
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(Array.from({ length: value.length }, (_, index) => copy(value[index], depth + 1, jsonWire)));
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, PlainData> = {};
      for (const key of Object.keys(value)) {
        Object.defineProperty(out, key, {
          value: copy((value as Record<string, unknown>)[key], depth + 1, jsonWire), enumerable: true,
        });
      }
      return Object.freeze(out);
    }
  }
  throw new SnapshotError('Unsupported plain data');
}

// Property order does not change the meaning of a plain record.
export function equalData(a: PlainData, b: PlainData): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, PlainData>, right = b as Record<string, PlainData>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key =>
    Object.hasOwn(right, key) && equalData(left[key]!, right[key]!));
}
