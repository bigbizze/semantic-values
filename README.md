# Semantic values

A small Zod-native primitive for opaque nominal values. Zod 4 is a required peer dependency. This package is private and unpublished.

Structural typing can describe a string or graph without proving its semantic rules were checked. `defineSemantic` adds controlled construction, nominal distinction, detached immutable data and definition-local runtime membership. Zod owns validation, native wire formats and schema composition.

```ts
import { z } from 'zod';
import { defineSemantic } from '@bigbizze/semantic-values';

const skuIdentity = Symbol('Sku');
export const Sku = defineSemantic(skuIdentity, {
  schema: z.codec(z.string(), z.string().regex(/^[A-Z]{2}-[0-9]{3}$/), {
    decode: text => text.trim().toUpperCase(),
    encode: text => text,
  }),
});
export type Sku = ReturnType<typeof Sku.create>;

function describe(sku: Sku): string { return Sku.read(sku); }
const sku = Sku.create('ab-123');
describe(sku);                 // "AB-123"
Sku.encode(sku);               // "AB-123"
JSON.stringify(sku);          // '"AB-123"'
Sku.is(sku);                   // true
const local = Sku.codec.parse(JSON.parse(JSON.stringify(sku)));
```

`read` returns the frozen native schema output. The handle itself has no public data properties. `encode` returns the frozen native input representation established during construction. A handle is distinct from both. `create(unknown)` and `codec.parse(unknown)` reconstruct through the same checks; there is no separate `decode` wrapper. Use `z.decode(Type.codec, input)` for Zod's typed decoding API.

For validation without normalization, an ordinary encodable schema is sufficient:

```ts
const labelIdentity = Symbol('Label');
const Label = defineSemantic(labelIdentity, { schema: z.string().regex(/^[a-z]+$/) });
```

## Schema composition

```ts
const Order = z.object({
  sku: Sku.codec,
  quantity: z.number().int().positive(),
  related: z.array(Sku.codec),
});
const order = Order.parse({ sku: 'ab-123', quantity: 2, related: ['cd-456'] });
Sku.read(order.sku); // "AB-123"
const wire = z.encode(Order, order);
// { sku: "AB-123", quantity: 2, related: ["CD-456"] }
const received = Order.parse(JSON.parse(JSON.stringify(wire)));
```

Objects, arrays, tuples, unions, discriminated object unions, optional/nullable fields and refinements use ordinary Zod composition. For valid stable records, `JSON.stringify(order)` and `JSON.stringify(z.encode(Order, order))` produce the same native values. Explicit encoding also checks the surrounding schema. Ordinary JSON only invokes each handle's `toJSON`.

When exporting composed schemas for declaration emission, TypeScript can require an explicit shape annotation (TS2527). Keep identity symbols private and refer to the definition's codec:

```ts
export const SkuList: z.ZodObject<{ items: z.ZodArray<typeof Sku.codec> }> =
  z.object({ items: z.array(Sku.codec) });
```

Schema composition produces ordinary mutable records containing authentic children. It does not establish an immutable outer invariant. An outer semantic definition can retain validated canonical child representations and reconstruct children when read. See the runnable `Bundle` example for a cross-field constraint. Opaque child handles are deliberately not supported as retained schema output.

## Supported data and schemas

Schemas must be synchronous and encode finite JSON-like data: null, booleans, strings, finite numbers, arrays and plain records, with at most 128 nesting levels. Dates, maps, undefined values, cycles and custom instances are unsupported. Optional omitted record fields work; explicit undefined does not. Records retain enumerable string keys. Arrays retain indexed slots, including non-enumerable indices, and omit extra properties. Copying runs getters; symbols and non-enumerable record properties are outside the data model.

Construction snapshots input before validation, snapshots schema output, encodes it, and validates a detached encoded snapshot again. The reconstructed output must equal the retained data, and its encoding must equal the retained wire (record key order is ignored). Negative zero is supported in native output only when the schema encodes it losslessly, for example as a string; negative zero in wire data is refused because JSON changes it to zero. No handle is issued if encoding or this replay check fails. Use bidirectional `z.codec` for transformations. One-way `z.transform` schemas fail construction with Zod's unidirectional-encoding error; the generic Zod type does not statically prove encodability.

Schemas and callbacks remain trusted application code. They must be deterministic, repeatable, side-effect-free and stable after definition. A successful replay check cannot prove future behavior or purity. It runs parsing and encoding twice during construction; later reads and encodes use retained snapshots without running the schema again. Do not change the meaning of a shared schema after use. Versioned envelopes, if needed, belong in the application's Zod schema.

## Errors and sensitive data

Invalid input produces ordinary Zod failures, including `safeParse` and `z.safeDecode`. Nonmember codec encoding produces a Zod failure, including `z.safeEncode`. Direct `read` and `encode` reject nonmembers with `TypeError`. Non-Zod callback exceptions propagate. A callback-thrown native Zod error is treated as a redacted validation failure during initial parsing and as a generic programmer TypeError during encoding or replay. Unsupported schema output, an unencodable schema or changed replay meaning are programmer errors, not ordinary validation failures.

Semantic validation issues use a generic message and omit input and internal schema paths. Surrounding field and array paths remain available. Zod Mini schemas and schemas from a separate Zod installation are supported; the exposed codec uses full Zod. No public validation-error classes are required.

```ts
const secretIdentity = Symbol('SensitiveText');
const SensitiveText = defineSemantic(secretIdentity, {
  schema: z.string().min(1), sensitive: true,
});
const secret = SensitiveText.create('example-only');
// JSON.stringify({ secret }) throws without including the value.
const explicit = SensitiveText.encode(secret); // deliberate disclosure
const message = z.object({ secret: SensitiveText.codec });
z.encode(message, { secret });                // also deliberate disclosure
```

Sensitivity prevents implicit JSON of the handle, including nested handles. It is not confidentiality against JavaScript code that can call `read` or `encode`. Sensitivity does not propagate into independently encoded plain data or an outer semantic value. Mark an outer definition sensitive when needed. Do not log arbitrary Zod errors containing sensitive inputs: parent union errors with `reportInput: true`, application callbacks and custom error maps can disclose data despite redacted semantic leaf issues.

## Runtime boundaries and limits

Separately executed definitions have separate membership, even if their symbols, schemas and wire formats appear identical. Send native representations and run the receiving schema. Foreign handles are rejected; a label or matching shape does not confer membership. JSON parsing alone never restores nominal types. Receiving validation establishes the receiver's rules; matching wire shapes do not prove two definitions have identical meaning.

Use one authoritative application definition where shared meaning is required. Schema changes can reject older wire values. Previously minted handles still serialize through their original owner, but the receiver always applies its current schema.

TypeScript rejects ordinary structural substitutes and distinct declaration-site identities. Reusing an identity symbol for another same-output definition defeats static distinction; declare one per type. Casts, `any`, `Object.assign`, `structuredClone` and proxies can preserve apparent types without membership. Supported reads and encodes still reject invalid copies. Unchecked application consumers remain the application's responsibility.

Ordinary JSON is supported, not every serialization protocol. React Server Component props should use explicit composed `z.encode` and receiving-side parsing; raw custom handles are not promised to work. Mutable records with changing getters are not immutable semantic boundaries. Construction history, external acceptance and changing external facts cannot be established by this pure-value primitive.

## Development

Node 24 or newer. Run `npm ci`, `npm run check`, and `npm run example`. Checks include packed-package exports, declaration consumers, independent module instances and another process. No publishing workflow or license grant is included.
