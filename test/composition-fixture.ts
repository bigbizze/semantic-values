import { Identifier, DependencyGraph } from '../examples/domains.ts';
import { Sku } from '../examples/composition.ts';
export function messageWire() {
  const owner = Identifier.encode(Identifier.create(' BLUE_WIDGET '));
  const sku = Sku.encode(Sku.create('ab-123'));
  return { owner, items: [sku], graph: DependencyGraph.encode(DependencyGraph.create({ nodes: [
    { id: 'base', dependencies: [] }, { id: 'assembly', dependencies: ['base'] },
  ] })), pair: [owner, sku] as [typeof owner, typeof sku], selected: sku, note: null };
}
