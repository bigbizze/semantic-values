# Process construction contracts

The experiment uses one `defineSemantic` factory. The configuration selects which operations exist; it does not give every definition a constructor that can bypass its checks.

| Mode | Construction | Checked consumption | Portable reconstruction |
| --- | --- | --- | --- |
| Data | `create`, `codec` | `read`, `encode`, `is` | Validate the native representation |
| Local process | `establish` | `read`, `is`, `valueSchema` | None |
| Portable process | `establish`, evidence-verifying `codec` | `read`, `encode`, `is`, `valueSchema` | Verify evidence and validate the returned subject |

`valueSchema` accepts existing local handles. It never creates one from ordinary data. Process definitions have no `create`. Data definitions have no `establish`.

## Three concrete claims

### Dependency graph

`DependencyGraph` in `examples/domains.ts` establishes that node names are distinct and every edge connects two different existing nodes. Its retained graph cannot change through an input alias or a returned observation. It does not establish acyclicity, execution order, or the availability of an external resource.

```ts
import { DependencyGraph } from './examples/domains.ts';

const graph = DependencyGraph.create({ nodes: ['source', 'result'], edges: [['source', 'result']] });
const wire = DependencyGraph.encode(graph);
const received = DependencyGraph.codec.parse(wire);
DependencyGraph.read(received);
```

### Request that passed entry checks

A local request type should mean: **these exact retained fields passed the configured entry checks at establishment**. It does not mean an action remains permitted now.

The small `CheckedRequest` fixture checks a nonempty text and `source === 'entry'`. A caller can supply that source string. The fixture therefore proves neither trusted origin nor actual application approval. Its purpose is to exercise the construction mechanism. It must not be copied as an application access check.

An application's definition module binds its existing checks instead:

```ts
import { z } from 'zod';
import { defineSemantic } from 'semantic-values';

const RequestContext = z.object({ action: z.string(), target: z.string() });
type RequestContext = z.output<typeof RequestContext>;
const checkedIdentity = Symbol('CheckedRequest');

// Called by the application's composition code with its existing trusted check procedure.
function configureCheckedRequest(
  runEntryChecks: (context: Readonly<RequestContext>) => Promise<boolean>,
) {
  return defineSemantic(checkedIdentity, {
    kind: 'process',
    schema: RequestContext,
    establish: async context => ({ ok: await runEntryChecks(context) }),
  });
}

async function example(runEntryChecks: (context: Readonly<RequestContext>) => Promise<boolean>) {
  const CheckedRequest = configureCheckedRequest(runEntryChecks);
  type CheckedRequest = Awaited<ReturnType<typeof CheckedRequest.establish>>;
  function consume(request: CheckedRequest) {
    return CheckedRequest.read(request).target;
  }
  const request = await CheckedRequest.establish({ action: 'inspect', target: 'document' });
  return consume(request);
}
```

Configure the definition once in its owning module and export the required operations. Do not let ordinary callers select a replacement check procedure. Reusing this configuration function creates definition-local instances, not shared membership. A separate semantic type needs its own identity declaration.

If existing checks throw on refusal, call them and return `{ ok: true }` only after they succeed. Their non-Zod exceptions still propagate. If they return an explicit negative result, preserve it; successful function completion is not approval. Do not accept a caller-provided `checked` flag as a substitute.

The supplied context must contain the subject fields the check actually uses. If checks depend on other facts, the application owns that binding and the lifetime of those facts. The package does not replace execution-time checks or enforce architectural ownership of the producer.

### Reviewed document

The synthetic review service in `examples/process-domain.ts` records an accepted document under an event identifier. `ReviewedDocument` means: **the configured verifier accepted a review-completed event for this exact title and body**.

```ts
import { z } from 'zod';
import { reviewService } from './examples/process-domain.ts';
import { reviewedDocument } from './examples/process.ts';

const service = reviewService();
const Sender = reviewedDocument(service, true);
const Receiver = reviewedDocument(service, true);
const value = await Sender.establish({ title: 'Example', body: 'Review this document' });
const Outgoing = z.object({ document: Sender.codec });
const Incoming = z.object({ document: Receiver.codec });
const wire = await z.encodeAsync(Outgoing, { document: value });
const received = await Incoming.parseAsync(JSON.parse(JSON.stringify(wire)));
Receiver.read(received.document);
```

Initial establishment calls the review procedure once, verifies the resulting evidence, and compares its verified subject to the established snapshot. Reconstruction invokes verification only. Evidence shape is necessary but insufficient: the service also checks the recorded event, claim, and document. Changing the received document cannot change what the recorded review established.

The synthetic service is not a production authority. Another environment needs access to an appropriate trusted evidence source. Sharing the verifier's source is different from sharing semantic handle identity. No global semantic registry is required.

## Runtime and transport boundaries

Each definition owns its local membership. Re-evaluating a module does not adopt its previous handles. Data values cross boundaries as native representations; portable process values cross as evidence; the receiving definition constructs local handles. Local process handles have no restoration path.

Use explicit composed encoding for React Server Component props where needed. Receiving-side parsing must run in the environment that owns the consuming definition. This experiment tests JSON, independently evaluated modules, and another Node process. It does not test a live Next.js deployment or integration with an application's existing action checks. No per-module adapter reconstruction or new framework integration is required by the evidence obtained.

Async verifiers require `portable.async: true` and Zod's async APIs. Synchronous misuse stops before starting the verifier. Callbacks use normal JavaScript Promise behavior. Deliberately corrupted Promises and maliciously replaced callback behavior are outside the contract.

## What the abstraction removes

The protected class comparison uses module-private tokens and JavaScript private fields. It provides genuine runtime construction control. Its flat string-only domain permits simple detached copies and freezing; it is not a general replacement for the library's bounded snapshot and replay machinery.

Both approaches can enforce the demonstrated claims. The reusable definition removes repeated implementation of opaque storage, deep snapshots, checked reading and encoding, local membership predicates, Zod issue handling, reverse-encoding guards, evidence-to-subject comparison, and serialization policy. The application still writes the substantive checks, review procedure, evidence format, and verifier.

This is a practical benefit beyond moving callbacks into configuration. It is not a stronger source of authority than a correctly protected class. For a single flat domain, the class can remain simpler. For multiple types needing these same boundaries, the shared implementation makes construction and consumption more consistent.

The candidate adds no dependency or alternate schema system. Core source grows from 137 to 265 physical lines; the two generic bindings use 22 lines and the domain-specific class examples use 81, excluding their shared domain fixture. These counts describe cost, not equivalent coverage or proof of value.

## Verification and recommendation

The retained suite checks negative establishment, missing construction routes, fabricated and foreign handles, mutable aliases, evidence substitution, unchanged establishment counts during reconstruction, async Zod behavior, sensitive JSON, nominal distinctions, and emitted mode-specific declarations. Packed-package consumers exercise independent modules and another process. Existing data tests retain replay, immutable snapshots, Zod Mini, separate Zod installations, and refined-union encoding regressions.

The prior practical declaration finding is already corrected: a verifier can return deeply readonly structured subjects, including arrays. The installed declaration fixture covers that case. No additional runtime defect or missing required test was found in this reassessment. Repeated Promise-mutation matrices remain excluded.

Retain one discriminated `defineSemantic` API as the candidate. A separate factory or broader process framework would add concepts without solving a demonstrated problem. The extension has a defensible purpose where consumers need repeated controlled process construction and evidence reconstruction. A small application can still choose protected classes. Adoption should be decided from those repeated obligations, not from line count alone or a claim that classes cannot do this.

No new freshness, revocation, authorization, ownership-enforcement, or transport primitive is needed. A real consumer integration would provide further adoption evidence; it is not required to establish the construction properties demonstrated here. Keep this work on the experimental branch until adoption is approved.
