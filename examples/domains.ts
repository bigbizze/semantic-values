import { defineSemantic } from '@bigbizze/semantic-values';

const identifierIdentity: unique symbol = Symbol('Identifier');
export const Identifier = defineSemantic(identifierIdentity, {
  contract: 'example.identifier', version: 1,
  parse(input) {
    if (typeof input !== 'string') throw new TypeError('Expected a string');
    const result = input.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,31}$/.test(result)) throw new TypeError('Invalid identifier');
    return result;
  },
});
export type Identifier = ReturnType<typeof Identifier.create>;

type Node = { id: string; dependencies: string[] };
function parseGraph(input: unknown): { nodes: Node[] } {
  if (typeof input !== 'object' || input === null || !('nodes' in input)
    || Object.keys(input).length !== 1 || !Array.isArray(input.nodes)
    || input.nodes.length === 0 || input.nodes.length > 64) throw new TypeError('Expected 1–64 nodes');
  const nodes: Node[] = input.nodes.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || !('id' in entry) || !('dependencies' in entry)
      || Object.keys(entry).length !== 2 || typeof entry.id !== 'string' || !/^[a-z]+$/.test(entry.id)
      || !Array.isArray(entry.dependencies) || entry.dependencies.length > 64
      || !entry.dependencies.every((id: unknown): id is string => typeof id === 'string')) {
      throw new TypeError('Invalid graph node');
    }
    return { id: entry.id, dependencies: [...entry.dependencies] };
  });
  const index = new Map(nodes.map((node) => [node.id, node.dependencies]));
  if (index.size !== nodes.length) throw new TypeError('Duplicate node');
  const active = new Set<string>();
  const complete = new Set<string>();
  function visit(id: string): void {
    const dependencies = index.get(id);
    if (!dependencies || active.has(id)) throw new TypeError('Missing reference or cycle');
    if (complete.has(id)) return;
    if (new Set(dependencies).size !== dependencies.length) throw new TypeError('Duplicate dependency');
    active.add(id);
    dependencies.forEach(visit);
    active.delete(id);
    complete.add(id);
  }
  nodes.forEach((node) => visit(node.id));
  return { nodes };
}
const graphIdentity: unique symbol = Symbol('DependencyGraph');
export const DependencyGraph = defineSemantic(graphIdentity, {
  contract: 'example.dependency-graph', version: 1, parse: parseGraph,
});
export type DependencyGraph = ReturnType<typeof DependencyGraph.create>;

const sensitiveIdentity: unique symbol = Symbol('SensitiveText');
export const SensitiveText = defineSemantic(sensitiveIdentity, {
  contract: 'example.sensitive-text', version: 1, sensitive: true,
  parse(input) {
    if (typeof input !== 'string' || input.length === 0) throw new TypeError('Expected nonempty text');
    return input;
  },
});
