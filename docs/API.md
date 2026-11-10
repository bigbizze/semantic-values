# API reference

Import the runtime API from `@bigbizze/semantic-values`. There is no separate Zod adapter entry point.

## `defineSemantic(identity, { schema, sensitive? })`

Creates a definition with `create`, `codec`, `read`, `encode` and `is`. The definition object is frozen.

- `identity`: a declaration-site unique symbol. `const identity = Symbol('Label')` infers the required type. Use a different declaration for each semantic type. The symbol's description is not an identifier or a compatibility rule.
- `schema`: a synchronous Zod 4 schema or bidirectional codec with supported plain-data input and output.
- `sensitive`: defaults to `false`. When true, implicit JSON serialization throws. Explicit reading and encoding remain available.

```ts
import { z } from 'zod';
import { defineSemantic } from '@bigbizze/semantic-values';

const countIdentity = Symbol('Count');
const Count = defineSemantic(countIdentity, {
  schema: z.codec(z.string(), z.number().int().nonnegative(), {
    decode: text => Number(text),
    encode: count => String(count),
  }),
});
type Count = ReturnType<typeof Count.create>;
const count = Count.create('12');
Count.read(count);   // 12: native schema output
Count.encode(count); // "12": native external representation
```

Zod Mini schemas and schemas from a separate Zod installation are supported. The exposed codec uses full Zod. The tested Zod version is 4.6.7.

## `Type.create(input: unknown)`

Parses external input and returns a locally authentic nominal value. It uses the same path as `Type.codec.parse(input)`.

Construction performs these operations before issuing a handle:

1. Copy input into a detached, frozen plain-data snapshot.
2. Parse it with the supplied schema, then snapshot its output.
3. Encode the output and snapshot the wire representation.
4. Parse that representation again, then encode the reconstructed output again.
5. Check that both reconstructed meaning and encoded representation are stable.

The equality checks ignore record key order but distinguish signed zero. Schemas must not assign different meaning to alias topology or other properties outside the supported data model. Each construction creates a distinct handle. Equal data does not imply reference equality.

Ordinary invalid input throws a Zod error. Use `Type.codec.safeParse` when a result object is more convenient.

## `Type.codec`

A composable Zod codec:

| Operation or type | Meaning |
| --- | --- |
| `z.input<typeof Type.codec>` | The supplied schema's input type |
| `z.output<typeof Type.codec>` | The nominal semantic handle type |
| `Type.codec.parse(unknown)` | Validate external input and construct a handle |
| `Type.codec.safeParse(unknown)` | Return a Zod success/failure result |
| `z.decode(Type.codec, wire)` | Typed decoding |
| `z.safeDecode(Type.codec, wire)` | Typed decoding with a result object |
| `z.encode(Type.codec, value)` | Authenticate a local handle and return its wire representation |
| `z.safeEncode(Type.codec, value)` | Encoding with a result object |

Objects, arrays, tuples, unions, discriminated object unions, refinements, optional fields and nullable fields use normal Zod composition. Invalid semantic fields report the surrounding field or array path. Encoding checks membership even in refined unions. The exposed `codec.out` schema also checks membership; it cannot create a handle from ordinary data. The codec's input schema carries the wire type; use the complete codec, not `codec.in`, to establish semantic validity.

## `Type.read(value)`

Authenticates local membership and returns a deeply readonly view of the retained schema output. Arrays and records are frozen at runtime. The handle has no public data properties. Reading does not rerun validation.

A fabricated, cloned, proxied or foreign handle throws `TypeError`, even if TypeScript still assigns it the nominal type.

## `Type.encode(value)`

Authenticates local membership and returns the retained native external representation. It does not rerun the schema. The returned data is frozen, although its TypeScript type is the schema's native input type and may permit mutation syntactically. Copy it before making changes; a changed copy must be validated again before it has any semantic guarantee.

A nonmember throws `TypeError`. Sensitive definitions allow explicit encoding.

## `Type.is(input: unknown)`

A definition-local runtime membership check and TypeScript type guard. It does not validate ordinary data or adopt a foreign handle. Identical schemas, symbol descriptions and wire formats do not make separately executed definitions share membership.

## JSON and sensitive values

For ordinary handles, `toJSON()` authenticates its receiver and returns the same representation as `Type.encode`. This works directly and inside ordinary records and arrays. Borrowing the method does not authenticate its new receiver.

For sensitive handles, `toJSON()` throws without including their contents. Explicit `Type.encode` and `z.encode` are deliberate disclosure operations. Encoded plain data has no sensitivity flag. An outer semantic definition that retains sensitive child representations must opt into its own sensitive policy.

JSON parsing never reconstructs membership. Select the receiving definition or composed schema and parse the received data.

## Supported data

Input, retained output and wire representations must fit this bounded data model:

- Null, booleans, strings and finite numbers.
- Arrays and plain records, including records with a null prototype.
- A maximum nesting depth of 128.

Dates, maps, sets, functions, undefined values, custom instances, cycles and nested opaque handles are unsupported. Omitted optional properties work; an explicit undefined property does not.

Record copies retain enumerable string keys. Array copies retain indexed slots, including non-enumerable indices, but omit extra properties and ignore custom iterators. Copying runs getters. Symbols and non-enumerable record properties are outside the data model. Sparse arrays with missing values are rejected. Shared references are copied independently; alias identity is not retained.

Negative zero may be retained as native output if the schema uses a lossless wire representation, such as a string. Negative zero in wire data is refused because JSON changes it to zero.

## Schema requirements and errors

Use an ordinary encodable Zod schema for validation, or `z.codec` for transformations with a reverse direction. A one-way transform throws Zod's unidirectional-encoding error during construction. The generic schema type cannot prove encodability statically.

Callbacks must be synchronous, deterministic, repeatable, side-effect-free and stable after definition. They receive data that may be frozen. A successful construction checks one replay; it cannot prove arbitrary callback purity or future behavior. Parsing and encoding each run twice during construction. Reads and encodes then use retained snapshots.

| Failure | Result |
| --- | --- |
| Invalid input or unsupported input snapshot | Redacted Zod validation failure |
| Nonmember through codec encoding or `codec.out` | Redacted Zod validation failure |
| Nonmember through direct `read` or `encode` | `TypeError` |
| Unsupported schema output or rejected encode/replay | Generic programmer `TypeError` |
| Changed reconstructed meaning or wire | Programmer `TypeError` |
| One-way transformation | Native Zod encoding error |
| Other non-Zod callback exception | Original exception propagates |

A callback-thrown native Zod error is treated as validation failure during initial parsing, and as a programmer error during encoding or replay. Consequently, `safeParse` and related safe APIs return failures for expected validation problems; they do not catch arbitrary programmer errors.

Semantic issues omit input, internal schema messages and internal schema paths. Surrounding paths remain available. This is not a general logging filter: parent union errors with `reportInput: true`, custom error maps and application callbacks can disclose input. Do not log arbitrary error objects containing sensitive data.

## Composition and immutable outer invariants

A Zod object containing semantic fields is an ordinary mutable object containing authentic children. Encoding it validates the composed schema, but does not make the outer record immutable. Changing getters are not a stable input contract.

An outer semantic type can validate children through a composed schema, check a relation between them, and retain the canonical encoded result as plain data. Reconstruct children through the composed schema when consuming the outer value. The runnable [Bundle example](https://github.com/bigbizze/semantic-values/blob/main/examples/composition.ts) checks that a nonempty item list is distinct and contains its selection, after normalizing the child SKUs. Invalid children and invalid combinations are both refused.

This is different from storing child handles inside an outer handle. That storage model is intentionally unsupported.

## Declaration emission

Export a definition and its value type while keeping the identity private:

```ts
const labelIdentity = Symbol('Label');
export const Label = defineSemantic(labelIdentity, { schema: z.string().min(1) });
export type Label = ReturnType<typeof Label.create>;
```

Exported composed schemas can require an explicit shape annotation to avoid TypeScript TS2527:

```ts
export const Labels: z.ZodObject<{ items: z.ZodArray<typeof Label.codec> }> =
  z.object({ items: z.array(Label.codec) });
```

Type-only exports are `Semantic<T, Id>`, `SemanticCodec<Value, Wire>`, `SemanticDefinition<T, Wire, Id>` and `ReadonlyData<T>`. Most consumers can infer their types from the definition and codec.

## Runtime boundaries

Transfer native representations, then validate with the receiving schema. The receiver establishes its own rules and local membership. A common wire shape does not prove semantic equivalence; use one authoritative application definition when code must share meaning.

After a module reload, an old handle remains usable by its original definition. A new definition must reconstruct it from encoded data and may reject it if its rules changed. No global registry, automatic adoption or compatibility service is involved.

TypeScript rejects ordinary structural substitutes, but casts, `any`, `Object.assign`, `structuredClone` and proxies can retain an apparent type without runtime membership. Checked operations still reject them. Reusing one identity symbol for multiple same-output definitions also defeats static distinction; declare one identity per type.

Ordinary JSON, separate module instances and another Node process are tested. This does not establish compatibility with every framework serializer. Use explicit encoded representations for React Server Component props and reconstruct at receipt. Construction-history claims and facts about changing external state need separate verification.
