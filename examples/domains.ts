import { z } from 'zod';
import { defineSemantic } from 'semantic-values';

const identifierIdentity = Symbol('Identifier');
export const Identifier = defineSemantic(identifierIdentity, { schema: z.string().regex(/^[a-z]+$/) });
export type Identifier = ReturnType<typeof Identifier.create>;
const skuIdentity = Symbol('Sku');
export const Sku = defineSemantic(skuIdentity, {
  schema: z.codec(z.string(), z.string().regex(/^[A-Z]{2}-[0-9]{3}$/), {
    decode: text => text.trim().toUpperCase(), encode: text => text,
  }),
});
export type Sku = ReturnType<typeof Sku.create>;
const graphIdentity = Symbol('DependencyGraph');
export const DependencyGraph = defineSemantic(graphIdentity, {
  schema: z.object({ nodes: z.array(z.string()), edges: z.array(z.tuple([z.string(), z.string()])) })
    .refine(graph => new Set(graph.nodes).size === graph.nodes.length &&
      graph.edges.every(([from, to]) => from !== to && graph.nodes.includes(from) && graph.nodes.includes(to)),
    { message: 'Nodes must be distinct and edges must reference different existing nodes' }),
});
const sensitiveIdentity = Symbol('SensitiveText');
export const SensitiveText = defineSemantic(sensitiveIdentity, { schema: z.string().min(1), sensitive: true });
