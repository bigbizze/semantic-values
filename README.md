# semantic-values

## Why

TypeScript can tell you that a graph has a list of nodes and a list of edges. That doesn't tell you whether the nodes are unique, or whether every edge points to a node that exists.

A function accepting that graph might depend on both of those things. Its argument type usually says neither.

People familiar with a codebase carry some of this context in their heads. An AI agent working on one function may see an object with the right properties and construct another one. The code typechecks. The assumptions the rest of the application relies on haven't been established.

You can document the rule: “Only use graphs produced by this validator.” But then every caller has to remember it. A comment doesn't stop someone from assembling the same object shape somewhere else.

`defineSemantic` lets a function ask for a value whose construction went through a particular Zod schema. An ordinary object with matching properties cannot substitute for its nominal TypeScript type. The value's data is private and immutable, and reading or encoding it checks that it belongs to the definition.

The checks still have to be right. The library makes callers go through them; it doesn't decide what a valid graph means for your application.

## Define a value

This SKU has a canonical spelling. Callers can provide lowercase text or surrounding spaces, but a successfully constructed value always contains the validated uppercase form.

```ts
import { z } from 'zod';
import { defineSemantic } from 'semantic-values';

const skuIdentity = Symbol('Sku');
export const Sku = defineSemantic(skuIdentity, {
  schema: z.codec(
    z.string(),
    z.string().regex(/^[A-Z]{2}-[0-9]{3}$/),
    {
      decode: text => text.trim().toUpperCase(),
      encode: text => text,
    },
  ),
});
export type Sku = ReturnType<typeof Sku.create>;

function stockKey(sku: Sku): string {
  return Sku.read(sku);
}

const sku = Sku.create(' ab-123 ');
stockKey(sku);        // "AB-123"
Sku.encode(sku);     // "AB-123"
JSON.stringify(sku); // '"AB-123"'

// stockKey('AB-123'); // TypeScript error: a string is not a Sku.
```

The symbol gives this declaration its own nominal type. Another declaration using a different symbol has a different type, even if its schema is identical. Keep the symbol private and export the definition.

An ordinary Zod schema works when no separate encoder is needed:

```ts
const labelIdentity = Symbol('Label');
const Label = defineSemantic(labelIdentity, {
  schema: z.string().regex(/^[a-z]+$/),
});
```

Use a bidirectional codec for transformations. A one-way Zod transform cannot provide the reverse encoding this library requires.

## Decode a whole message

Semantic values fit into ordinary Zod schemas. You don't have to decode each field yourself.

```ts
const Order = z.object({
  sku: Sku.codec,
  quantity: z.number().int().positive(),
  related: z.array(Sku.codec),
});

const order = Order.parse({
  sku: 'ab-123',
  quantity: 2,
  related: ['cd-456'],
});

Sku.read(order.sku); // "AB-123"

const wire = z.encode(Order, order);
// { sku: "AB-123", quantity: 2, related: ["CD-456"] }

const received = Order.parse(JSON.parse(JSON.stringify(wire)));
Sku.is(received.sku); // true
```

Zod determines the external representation. A string stays a string; an object uses the shape you declared. The library doesn't add a contract name, version or wrapper around it. If your protocol needs a version, put one in its schema.

Ordinary JSON also works: `JSON.stringify(order)` calls each semantic value's encoder. `JSON.parse` returns plain data. The receiving schema must validate it again before anyone can rely on its semantic type.

## Keep the guarantee where it belongs

A value belongs to the definition instance that created it. A separately executed copy of that definition doesn't authenticate the original object. It can validate the encoded representation and create its own legitimate value instead. This needs no shared runtime identity or registry.

These guarantees concern facts that can be checked from the data. A valid identifier doesn't prove that a database record currently exists. Reconstructing an artifact doesn't prove that someone previously reviewed it. Those claims need their own evidence or current checks.

TypeScript assertions, `any`, and some copy operations can retain an apparent nominal type without retaining runtime membership. `read`, `encode` and codec encoding reject those copies. Don't treat an unchecked type annotation as runtime authentication.

## Sensitive values

A definition can refuse accidental JSON serialization without preventing deliberate transport:

```ts
const secretIdentity = Symbol('SensitiveText');
const SensitiveText = defineSemantic(secretIdentity, {
  schema: z.string().min(1),
  sensitive: true,
});

const secret = SensitiveText.create('example-only');
// JSON.stringify({ secret }); // Throws.
SensitiveText.encode(secret);  // Deliberate disclosure is allowed.
```

Explicit Zod encoding also allows disclosure. This setting applies to the handle, not to plain data that has already been encoded.

## Use and documentation

The package is `semantic-values`. It requires Node 24 or newer and Zod `^4.6.7`:

```sh
npm install semantic-values zod
```

The [API reference](docs/API.md) covers each operation, schema requirements, errors, immutability and composition. Runnable examples include a [validated dependency graph](examples/domains.ts) and an [outer invariant involving semantic children](examples/composition.ts).

Ordinary JSON serialization is supported. Other protocols have their own rules. For React Server Component props, use explicit Zod encoding and receiving-side parsing; raw custom handles are not promised to work.

For development, run `npm ci`, `npm run check` and `npm run example`. See the [publication procedure](https://github.com/bigbizze/semantic-values/blob/main/PUBLISHING.md) for release steps. Licensed under [MIT](LICENSE).

## Designated processes

A valid document is not necessarily a reviewed document. `kind: 'process'` adds a separate construction route for claims that require a designated procedure. It exposes `establish`, not `create`; ordinary data validation cannot issue that stronger type. Local-only values have no decoding codec. A definition with evidence verification can reconstruct the claim through its codec without repeating the original procedure.

See [process definitions](docs/API.md#process-established-definitions) for the result contract, evidence requirements and async Zod behavior. This capability is under evaluation and is not part of the published 0.1.0 package.
