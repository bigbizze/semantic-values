import { defineSemantic, type Semantic } from '@bigbizze/semantic-values';
import { Identifier, DependencyGraph } from '../examples/domains.ts';
const first: unique symbol = Symbol('same');
const second: unique symbol = Symbol('same');
const options = { contract: 'example.same', version: 1, parse: (_input: unknown) => 'checked' };
const A = defineSemantic(first, options);
const B = defineSemantic(second, options);
const value = A.create(null);
// Regression: identical labels and data must remain distinct in the package's emitted declarations.
// @ts-expect-error -- distinct explicit identity
B.read(value);
// @ts-expect-error -- structural data cannot substitute for a nominal handle
A.read({});
// @ts-expect-error -- spread drops the protected nominal member
A.encode({ ...value });
// @ts-expect-error -- no unchecked representation property
value.representation;
// @ts-expect-error -- no unchecked data property
value.data;
// @ts-expect-error -- widened symbol cannot name a distinct definition
defineSemantic(Symbol() as symbol, options);
const NumberType = defineSemantic(first, { ...options, parse: () => 1 });
// @ts-expect-error -- generic data remains part of the nominal type
NumberType.read(value);
const graph = DependencyGraph.create({ nodes: [{ id: 'base', dependencies: [] }] });
// @ts-expect-error -- deeply readonly result
DependencyGraph.read(graph).nodes[0]!.dependencies.push('changed');
// @ts-expect-error -- unrelated semantic domain
Identifier.read(graph);
const outerIdentity = Symbol('outer');
// @ts-expect-error -- opaque child handles are not supported plain data
defineSemantic(outerIdentity, { ...options, parse: () => ({ child: value }) });
// These standard signatures preserve T but do not preserve runtime membership.
A.read(Object.assign({}, value));
A.encode(structuredClone(value));
A.read(new Proxy(value, {}));
A.read({} as typeof value);
declare const untyped: any;
A.encode(untyped);
// Reuse and ordinary factories are not generative static identities.
defineSemantic(first, options).read(value);
function factory() { const identity = Symbol('factory'); return defineSemantic(identity, options); }
factory().read(factory().create(null));
function forward<T, I extends symbol>(value: Semantic<T, I>): Semantic<T, I> { return value; }
A.read(forward(forward(value)));
type Alias = ReturnType<typeof A.create>;
const alias: Alias = value;
A.encode(alias);
