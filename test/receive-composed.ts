import { readFileSync } from 'node:fs';
import { Message, Sku } from '../examples/composition.ts';
import { Identifier, DependencyGraph } from '../examples/domains.ts';
const local = Message.parse(JSON.parse(readFileSync(0, 'utf8')));
process.stdout.write(JSON.stringify({ owner: Identifier.is(local.owner), item: Sku.is(local.items[0]), graph: DependencyGraph.is(local.graph) }));
