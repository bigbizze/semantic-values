import { defineSemantic } from 'semantic-values';
import { DocumentSchema, EvidenceSchema, RequestSchema, reviewService, checkRequest, type Evidence } from './process-domain.ts';

const reviewIdentity = Symbol('ReviewedDocument');
export function reviewedDocument(service: ReturnType<typeof reviewService>, asynchronous = false) {
  const { review, verify } = service;
  const portable = asynchronous
    ? { schema: EvidenceSchema, async: true as const, verify: async (evidence: Readonly<Evidence>) => verify(evidence) }
    : { schema: EvidenceSchema, verify };
  return defineSemantic(reviewIdentity, {
    kind: 'process', schema: DocumentSchema,
    establish: review,
    portable,
  });
}
const requestIdentity = Symbol('CheckedRequest');
export const CheckedRequest = defineSemantic(requestIdentity, {
  kind: 'process', schema: RequestSchema,
  establish: checkRequest,
});
export type CheckedRequest = Awaited<ReturnType<typeof CheckedRequest.establish>>;
export function requestText(request: CheckedRequest): string { return CheckedRequest.read(request).text; }
