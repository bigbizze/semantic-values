import { z } from 'zod';
import { $ZodError } from 'zod/v4/core';

/** Structural view of the existing definition; no predicate or contract metadata is duplicated. */
type Definition<Value, Wire> = {
  decode(input: unknown): Value;
  encode(value: Value): Wire;
  is(input: unknown): input is Value;
};
export type SemanticCodec<Value, Wire> = z.ZodCodec<
  z.ZodCustom<Wire, Wire>, z.ZodCustom<Value, Value>
>;

export function semanticCodec<Value, Wire>(definition: Definition<Value, Wire>): SemanticCodec<Value, Wire> {
  // The wire schema carries its type only. The definition performs all forward validation.
  return z.codec(z.custom<Wire>(), z.custom<Value>(definition.is, { error: 'Expected local semantic value' }), {
    decode(input, context) {
      try { return definition.decode(input); }
      catch (error) {
        if (!((error instanceof TypeError && 'code' in error && error.code === '@bigbizze/semantic-values/validation')
          || (error instanceof RangeError && 'code' in error && error.code === '@bigbizze/semantic-values/depth') || error instanceof $ZodError)) throw error;
        // Keep the surrounding schema path, but do not disclose parser messages, input or internal paths.
        context.issues.push({ code: 'custom', input: undefined, message: 'Invalid semantic representation' });
        return z.NEVER;
      }
    },
    encode(value, context) {
      // Refined schemas run a reverse canary that skips custom checks.
      if (!definition.is(value)) {
        context.issues.push({ code: 'custom', input: undefined, message: 'Expected local semantic value' });
        return z.NEVER;
      }
      return definition.encode(value);
    },
  });
}
