# Semantic values

A small TypeScript primitive for opaque, nominal values with validated immutable data. The package is private and is not published to npm. No license grant is provided.

Structural types describe shape. They cannot by themselves establish that a value passed a semantic check. `defineSemantic` binds a parser to a nominal type and keeps the checked data in private, definition-local storage. Its core has no runtime dependencies.

## Define and use a type

```ts
import { defineSemantic, SemanticValidationError } from '@bigbizze/semantic-values';

const identifierIdentity: unique symbol = Symbol('Identifier');
const Identifier = defineSemantic(identifierIdentity, {
  contract: 'example.identifier',
  version: 1,
  parse(input) {
    if (typeof input !== 'string') throw new SemanticValidationError('Expected a string');
    const name = input.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,31}$/.test(name)) throw new SemanticValidationError('Invalid identifier');
    return name;
  },
});
type Identifier = ReturnType<typeof Identifier.create>;

function label(value: Identifier): string {
  return Identifier.read(value);
}
const value = Identifier.create(' BLUE_WIDGET ');
label(value); // 'blue_widget'
// label('blue_widget'); // Type error: an ordinary string is not an Identifier.

const json = JSON.stringify({ value, values: [value] });
const received = JSON.parse(json);
const local = Identifier.decode(received.value);
label(local);
```

Runnable identifier, dependency graph and sensitive-text examples are in `examples/`. The graph parser checks unique nodes, existing references and absence of dependency cycles, rather than just primitive property types.

## API and guarantees

| Operation | Behavior |
| --- | --- |
| `Type.create(input)` | Snapshot supported data, run the trusted parser, retain a detached frozen result and issue a local handle |
| `Type.decode(representation)` | Check the exact contract/version envelope, then validate and construct locally |
| `Type.read(value)` | Authenticate local membership and return immutable data |
| `Type.encode(value)` | Authenticate local membership and return a plain frozen `{ contract, version, data }` representation |
| `Type.is(input)` | Check local runtime membership only; never adopt a foreign object |

Handles have no public data or representation properties. Ordinary `JSON.stringify` invokes their checked `toJSON` method and produces the same representation as explicit `encode`. This works inside ordinary records and arrays. Parsing JSON produces untrusted ordinary data, not a nominal value. Select the receiving definition explicitly and call `decode`; reconstruct compound messages field by field or with an application schema.

Parsers are trusted, receiver-free callbacks. A bound schema parser or a closure can be supplied without adding its schema library as a dependency of this package. The library does not prove parser correctness or determinism. Parsers may normalize data; claims must concern the returned contents. Invalid inputs throw either a boundary `TypeError`/`RangeError` or the parser's error. No partially checked handle is returned.

## Sensitive values

```ts
import { defineSemantic, SemanticValidationError } from '@bigbizze/semantic-values';

const sensitiveIdentity: unique symbol = Symbol('SensitiveText');
const SensitiveText = defineSemantic(sensitiveIdentity, {
  contract: 'example.sensitive-text', version: 1, sensitive: true,
  parse(input) {
    if (typeof input !== 'string' || !input.length) throw new SemanticValidationError('Expected nonempty text');
    return input;
  },
});
const value = SensitiveText.create('demonstration-only');
try { JSON.stringify({ value }); }
catch (error) { console.log(error instanceof Error ? error.message : 'Serialization refused'); }
JSON.stringify(SensitiveText.encode(value)); // Deliberate disclosure is allowed.
SensitiveText.read(value);                  // Deliberate access is allowed.
```

`sensitive` defaults to `false` and is captured when the definition is created. It restricts implicit JSON only. It is not confidentiality against code allowed to read or encode. Once explicitly encoded, ordinary data carries no sensitivity policy; nesting it in another value does not restore that policy. Other serializers and loggers may not use `toJSON`.

## Independent executions and transport

Runtime membership belongs to one execution of a definition. Another copy of that definition does not recognize its opaque handles. Send an encoded representation or ordinary JSON and let the receiver validate it:

```ts
const wire = Sender.Type.encode(value);
const local = Receiver.Type.decode(wire);
```

Use one authoritative exported definition per contract in a monorepo. Re-executing that definition is supported; independently rewriting its predicate under the same name does not prove equivalence. Contract identifiers and versions are application-owned. Changed meanings need deliberate versioning, and any migration must revalidate under the receiving rules.

Foreign handles cannot be read or encoded by the receiver. Their owning serializer can still export them while it remains available. If only an opaque foreign handle survives, obtain a representation from its owner or the original source.

Ordinary JSON conventions are supported, not every framework transport. React Server Component prop boundaries should pass `Type.encode(value)` and call `Type.decode` at the receiver. Do not rely on raw custom handles being accepted as props. This project does not include a framework integration fixture or promise universal framework compatibility.

## Type and data limits

- Each type needs a declaration-site `unique symbol`. An ordinary factory does not create a fresh static identity per call. Reusing a symbol can reuse its static type while runtime membership stays separate.
- Structural lookalikes and spread copies are rejected statically. `Object.assign`, `structuredClone`, proxies, assertions and `any` can preserve or claim a nominal type without membership. Checked reads, encodes and borrowed serializers reject those objects. Clones may serialize as `{}` because they have lost both authority and their serializer.
- Static types do not execute checks. Protected consumers must use the owning API; a cast or an unchecked effect is not proof of legitimacy.
- Supported data is null, booleans, finite numbers, strings, arrays and plain objects. Nested values are detached and frozen, with the data root at depth 0 and descendants supported through depth 128. Total size is not bounded; applications must constrain input size. Enumerable string keys are retained; symbols and nonenumerable keys are omitted. Getters run during snapshotting. Dates, maps, functions, opaque handles and cyclic data are unsupported.
- Ordinary records may hold local handles, but composite semantic values should retain child representations and explicitly decode children. There is no arbitrary object-graph framework.
- This primitive establishes pure value invariants. It cannot independently establish construction history, external approval or the continuing truth of mutable external state. Those need application-specific verification.

## Development

Node.js 24 or later is required for the examples and test runner.

```sh
npm ci
npm run check
npm run example
npm pack --dry-run
```

`check` builds JavaScript and declarations, checks source/examples/type fixtures, runs focused runtime tests, and installs a local tarball in an isolated consumer to verify package exports, emitted nominal types, independent modules and process reconstruction. Generated output is ignored by Git. The package remains private; there is no publishing workflow.

## Optional Zod 4 composition

Install Zod separately to use the `./zod` export. Core consumers do not need it. The adapter uses Zod's bidirectional codecs; it does not duplicate semantic predicates or contract metadata.

```ts
import { z } from 'zod';
import { semanticCodec } from '@bigbizze/semantic-values/zod';
// Identifier is an existing authoritative semantic definition.
const Schema = z.object({ owner: semanticCodec(Identifier), aliases: z.array(semanticCodec(Identifier)) });
const input = { owner: Identifier.encode(value), aliases: [Identifier.encode(value)] };
const local = Schema.parse(input);
Identifier.read(local.owner);
const wire = z.encode(Schema, local);
```

The input type is the definition's encoded representation; the output is its nominal value. Decoding calls the definition's decoder. Encoding checks local membership before calling its encoder. Objects, arrays, tuples, unions and optional/nullable fields are supplied by Zod. An ordinary composed record is not itself immutable or semantically authenticated; its semantic children remain so.

Expected validation failures need an explicit distinction from bugs. Core input rejections use `SemanticValidationError` (a `TypeError`) or `SemanticDepthError` (a `RangeError`). Application parsers can throw `SemanticValidationError` for rejected input, or use a Zod parser. The adapter converts these errors and `ZodError` into a generic Zod issue at the semantic field's schema path. It does not copy parser messages or input into the issue. Other exceptions propagate, including ordinary `TypeError` and `RangeError`; do not broadly catch these as user input errors. Unsupported parser output is a programming error and propagates.

`safeParse` and `safeDecode` therefore return failures for declared validation rejections, not for arbitrary programmer exceptions. Parser-specific inner paths are deliberately omitted; the surrounding object/array path is retained. Other application schemas, custom messages or Zod's input-reporting options remain the application's diagnostic policy.

`z.encode` is explicit disclosure, including sensitive children. `JSON.stringify(local)` still invokes each child's own policy and refuses sensitive values. Explicitly encoded plain data does not retain a sensitivity policy. For a valid plain composed message without extra fields, both paths produce equivalent JSON; ordinary JSON does not validate the compound schema or its cross-field rules.

Exporting composed schemas across declaration boundaries can require explicit codec type aliases and an exported object-shape annotation when child identities are private to another module. `examples/composition.ts` shows that boilerplate without exporting identity symbols or duplicating predicates. Local schemas generally infer without it. `SemanticCodec<Value, Wire>` is available as a type-only annotation.

An outer semantic value may validate child representations through a composed schema, check a relation between their decoded contents, and retain the encoded result. Reconstruct children through that schema on consumption. Native retention of opaque child handles remains unsupported. The bundle example enforces a distinct-item list containing the selected item; validating each child alone is insufficient.

### Reconstruction and diagnostic constraints

Portable parsers must be deterministic and replay stable: parsing their canonical output must succeed and preserve the same meaning. A one-way transformation (for example, stripping a required prefix on every parse) does not satisfy this contract. The library cannot prove parser purity or this law. Test canonical round trips for each application definition. The outer example also validates the exact child representation it retains; that check does not prove future stability for an arbitrary stateful parser.

An ordinary Zod schema is not an authenticated outer-value boundary. Zod can read an accessor more than once while encoding a refined object. Use stable plain application records for direct schema encoding. For an authenticated immutable outer invariant, use `Bundle.create`, which snapshots input before the parser runs. Do not treat direct `BundleFields` encoding of accessor-bearing or concurrently changing records as proof of its relation.

The error classes carry namespaced `code` values so errors from a second physical installation can be classified without matching constructor identity. This is an explicit validation-error convention, not an authenticity mechanism. Ordinary unmarked TypeError and RangeError still propagate. The adapter recognizes Zod 4 core errors, including Zod Mini. Every exception during parser-output snapshotting is replaced with a generic programmer TypeError, without copying its message or cause into diagnostics.

Adapter leaf issues are redacted. An enclosing Zod union with `reportInput: true` can still include the complete submitted representation in its own `invalid_union` issue. Leave input reporting disabled for sensitive input and review application-level diagnostics; child sensitivity does not redact enclosing Zod issues.
