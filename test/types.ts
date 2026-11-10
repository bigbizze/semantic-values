import { z } from 'zod';
import { defineSemantic } from 'semantic-values';
// @ts-expect-error -- broad symbols cannot establish declaration-site identity
defineSemantic(Symbol(), { schema: z.string() });
const processIdentity = Symbol('Process');
// @ts-expect-error -- an asynchronous verifier must declare the async boundary explicitly
defineSemantic(processIdentity, { kind: 'process', schema: z.string(), establish: () => ({ ok: true, evidence: 'event' }), portable: { schema: z.string(), verify: async () => ({ ok: true as const, subject: 'value' }) } });
