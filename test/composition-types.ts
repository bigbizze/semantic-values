import { z } from 'zod';
import { defineSemantic, type Representation } from '@bigbizze/semantic-values';
import { semanticCodec } from '@bigbizze/semantic-values/zod';
import { Message, Sku } from '../examples/composition.ts';
import { Identifier } from '../examples/domains.ts';
declare const order: z.output<typeof Message>;
Identifier.read(order.owner);
Sku.read(order.items[0]!);
Sku.read(order.pair[1]);
const selected: Identifier | ReturnType<typeof Sku.create> = order.selected;
const encoded = z.encode(Message, order);
const wire: z.input<typeof Message> = encoded;
const ownerWire: Representation<string> = wire.owner;
// Regression: schema output preserves private nominal identities and schema input is a typed portable representation.
// @ts-expect-error -- representation is not the nominal owner
Identifier.read(wire.owner);
// @ts-expect-error -- wrong semantic type
Sku.read(order.owner);
// @ts-expect-error -- nominal handles are not wire values
const wrongInput: z.input<typeof Message> = order;
// @ts-expect-error -- wire values cannot be encoded as already-verified output
z.encode(Message, wire);
// @ts-expect-error -- representation data type is not unknown or any
const wrongData: number = encoded.owner.data;
const a: unique symbol = Symbol('same');
const b: unique symbol = Symbol('same');
const A = defineSemantic(a, { contract: 'same', version: 1, parse: () => 'x' });
const B = defineSemantic(b, { contract: 'same', version: 1, parse: () => 'x' });
const schema = z.object({ a: semanticCodec(A), b: semanticCodec(B) });
declare const local: z.output<typeof schema>;
// @ts-expect-error -- identical underlying data and labels still have different nominal identities
B.read(local.a);
const Numeric = defineSemantic(a, { contract: 'same', version: 1, parse: () => 1 });
// @ts-expect-error -- generic data parameters remain distinct through codec inference
z.encode(semanticCodec(Numeric), local.a);
void [selected, ownerWire, wrongInput, wrongData];
