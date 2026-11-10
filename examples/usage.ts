import { Identifier, DependencyGraph, SensitiveText } from './domains.ts';

const name = Identifier.create(' BLUE_WIDGET ');
function label(value: Identifier): string { return Identifier.read(value); }
console.log(label(name));

const graph = DependencyGraph.create({ nodes: [
  { id: 'base', dependencies: [] }, { id: 'assembly', dependencies: ['base'] },
] });
const message = JSON.parse(JSON.stringify({ name, graphs: [graph] }));
const receivedName = Identifier.decode(message.name);
const receivedGraph = DependencyGraph.decode(message.graphs[0]);
console.log(Identifier.read(receivedName), DependencyGraph.read(receivedGraph).nodes.length);

const sensitive = SensitiveText.create('demonstration-only');
try { JSON.stringify({ sensitive }); }
catch (error) { if (error instanceof Error) console.log(error.message); }
console.log(JSON.stringify(SensitiveText.encode(sensitive))); // Explicit disclosure.
