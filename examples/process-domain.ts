import { z } from 'zod';

export const DocumentSchema = z.object({ title: z.string().min(1), body: z.string().min(1) }).strict();
export type Document = z.output<typeof DocumentSchema>;
export const EvidenceSchema = z.object({ event: z.string(), claim: z.literal('review-completed'), document: DocumentSchema }).strict();
export type Evidence = z.output<typeof EvidenceSchema>;

// Application-owned, synthetic event log. It is not a library registry or proof format.
export function reviewService() {
  const events = new Map<string, Readonly<Document>>();
  let calls = 0, verifications = 0;
  return {
    get calls() { return calls; }, get verifications() { return verifications; },
    async review(document: Readonly<Document>): Promise<{ ok: true; evidence: Evidence } | { ok: false }> {
      calls++;
      if (document.body.includes('reject')) return { ok: false };
      const event = `review-${calls}`;
      const accepted = Object.freeze({ ...document });
      events.set(event, accepted);
      return { ok: true, evidence: { event, claim: 'review-completed', document: { ...document } } };
    },
    verify(evidence: Readonly<Evidence>): { ok: true; subject: Document } | { ok: false } {
      verifications++;
      const stored = events.get(evidence.event);
      if (!stored || evidence.claim !== 'review-completed' || stored.title !== evidence.document.title || stored.body !== evidence.document.body) return { ok: false };
      return { ok: true, subject: stored };
    },
  };
}
export const RequestSchema = z.object({ source: z.string(), text: z.string().min(1) }).strict();
export function checkRequest(request: Readonly<z.output<typeof RequestSchema>>) { return { ok: request.source === 'entry' }; }
