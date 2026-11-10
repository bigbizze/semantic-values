import { z } from 'zod';
import { defineSemantic, SemanticValidationError, SemanticDepthError } from '@bigbizze/semantic-values';
import { semanticCodec, type SemanticCodec } from '@bigbizze/semantic-values/zod';
import { Identifier, DependencyGraph, SensitiveText } from './domains.ts';

const skuIdentity: unique symbol = Symbol('Sku');
export const Sku = defineSemantic(skuIdentity, {
  contract: 'example.sku', version: 1,
  parse: z.string().trim().toUpperCase().pipe(z.string().regex(/^[A-Z]{2}-[0-9]{3}$/)).parse,
});
type OwnerCodec = SemanticCodec<Identifier, ReturnType<typeof Identifier.encode>>;
type GraphCodec = SemanticCodec<DependencyGraph, ReturnType<typeof DependencyGraph.encode>>;
type SensitiveCodec = SemanticCodec<ReturnType<typeof SensitiveText.create>, ReturnType<typeof SensitiveText.encode>>;
type SkuCodec = SemanticCodec<ReturnType<typeof Sku.create>, ReturnType<typeof Sku.encode>>;
export const Message: z.ZodObject<{
  owner: OwnerCodec; items: z.ZodArray<SkuCodec>; graph: GraphCodec;
  pair: z.ZodTuple<[OwnerCodec, SkuCodec]>;
  selected: z.ZodUnion<[OwnerCodec, SkuCodec]>;
  note: z.ZodNullable<z.ZodOptional<SensitiveCodec>>;
}> = z.object({
  owner: semanticCodec(Identifier), items: z.array(semanticCodec(Sku)), graph: semanticCodec(DependencyGraph),
  pair: z.tuple([semanticCodec(Identifier), semanticCodec(Sku)]),
  selected: z.union([semanticCodec(Identifier), semanticCodec(Sku)]),
  note: semanticCodec(SensitiveText).optional().nullable(),
});
export type Message = z.output<typeof Message>;

// Manual codec baseline: same contract authority, but failure and membership handling repeat for every type.
export const ManualSku = z.codec(
  z.custom<ReturnType<typeof Sku.encode>>(),
  z.custom<ReturnType<typeof Sku.create>>(Sku.is, { error: 'Expected local SKU' }),
  { decode(wire, context) {
    try { return Sku.decode(wire); }
    catch (error) {
      if (!(error instanceof SemanticValidationError || error instanceof SemanticDepthError || error instanceof z.ZodError)) throw error;
      context.issues.push({ code: 'custom', input: undefined, message: 'Invalid SKU representation' });
      return z.NEVER;
    }
  }, encode(value, context) {
    if (!Sku.is(value)) {
      context.issues.push({ code: 'custom', input: undefined, message: 'Expected local SKU' });
      return z.NEVER;
    }
    return Sku.encode(value);
  } },
);

// Outer semantic invariant: the selected item must occur in the nonempty, duplicate-free item list.
// Retain verified child representations, then reconstruct children through one schema when consumed.
export const BundleFields: z.ZodObject<{ owner: OwnerCodec; selected: SkuCodec; items: z.ZodArray<SkuCodec> }> = z.object({
  owner: semanticCodec(Identifier), selected: semanticCodec(Sku), items: z.array(semanticCodec(Sku)).min(1),
}).superRefine((value, context) => {
  const items = value.items.map(Sku.read);
  if (new Set(items).size !== items.length || !items.includes(Sku.read(value.selected))) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Items must be distinct and contain the selection' });
  }
});
const bundleIdentity: unique symbol = Symbol('Bundle');
export const Bundle = defineSemantic(bundleIdentity, {
  contract: 'example.bundle', version: 1,
  parse(input) {
    const wire = z.encode(BundleFields, BundleFields.parse(input));
    BundleFields.parse(wire); // Check the representation that will actually be retained.
    return wire;
  },
});
export type Bundle = ReturnType<typeof Bundle.create>;
export function readBundle(value: Bundle): z.output<typeof BundleFields> { return BundleFields.parse(Bundle.read(value)); }
