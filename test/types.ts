import { z } from 'zod';
import { defineSemantic } from '@bigbizze/semantic-values';
const a = Symbol('same'), b = Symbol('same');
const A = defineSemantic(a, { schema: z.string() });
const B = defineSemantic(b, { schema: z.string() });
const NumberA = defineSemantic(a, { schema: z.number() });
const value = A.create('x');
// @ts-expect-error -- independent nominal identities remain distinct
B.read(value);
// @ts-expect-error -- output data type participates in nominal distinction
NumberA.read(value);
// @ts-expect-error -- ordinary strings cannot replace semantic handles
A.read('x');
// @ts-expect-error -- broad symbols cannot establish declaration-site identity
defineSemantic(Symbol(), { schema: z.string() });
const schema = z.object({ values: z.array(A.codec), other: B.codec.optional().nullable() });
const output = schema.parse({ values: ['x'] });
A.read(output.values[0]!);
// @ts-expect-error -- composition cannot erase nominal distinctions
B.read(output.values[0]!);
const wire: z.input<typeof schema> = z.encode(schema, output);
const text: string = wire.values[0]!;
// @ts-expect-error -- wire type must not widen to any
const number: number = wire.values[0]!;
void [text, number];
