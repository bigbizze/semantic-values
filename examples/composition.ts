import { z } from 'zod';
import { defineSemantic } from '@bigbizze/semantic-values';
import { Identifier, Sku, DependencyGraph } from './domains.ts';

// Explicit shape annotations allow declaration emission without exporting private identity symbols.
export const Order: z.ZodObject<{
  owner: typeof Identifier.codec;
  items: z.ZodArray<typeof Sku.codec>;
}> = z.object({ owner: Identifier.codec, items: z.array(Sku.codec) });

export const BundleFields: z.ZodObject<{
  selected: typeof Sku.codec; items: z.ZodArray<typeof Sku.codec>;
}> = z.object({ selected: Sku.codec, items: z.array(Sku.codec).min(1) }).refine(value => {
  const items = value.items.map(Sku.read);
  return new Set(items).size === items.length && items.includes(Sku.read(value.selected));
}, { message: 'Items must be distinct and contain the selection' });

// Retain native child representations, not handles. Both directions recheck the outer invariant.
const canonicalBundle = z.codec(z.object({ selected: z.string(), items: z.array(z.string()) }), z.object({ selected: z.string(), items: z.array(z.string()) }), {
  decode(input, ctx) {
    const result = BundleFields.safeParse(input);
    if (!result.success) { ctx.issues.push({ code: 'custom', input: undefined, message: 'Invalid bundle' }); return z.NEVER; }
    return z.encode(BundleFields, result.data);
  },
  encode(value, ctx) {
    const result = BundleFields.safeParse(value);
    if (!result.success) { ctx.issues.push({ code: 'custom', input: undefined, message: 'Invalid bundle' }); return z.NEVER; }
    return z.encode(BundleFields, result.data);
  },
});
const bundleIdentity = Symbol('Bundle');
export const Bundle = defineSemantic(bundleIdentity, { schema: canonicalBundle });
export function readBundle(value: ReturnType<typeof Bundle.create>): z.output<typeof BundleFields> {
  return BundleFields.parse(Bundle.read(value));
}
export const GraphMessage: z.ZodObject<{ graph: typeof DependencyGraph.codec; count: z.ZodNumber }> = z.object({ graph: DependencyGraph.codec, count: z.number().int().positive() });
