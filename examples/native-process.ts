import { z } from 'zod';
import { DocumentSchema, EvidenceSchema, RequestSchema, type Document, type Evidence, reviewService, checkRequest } from './process-domain.ts';

// Tokens and private fields, rather than TypeScript-private constructors alone, control issuance.
export function nativeReviewedDocument(service: ReturnType<typeof reviewService>, asynchronous = false) {
  const token = Object.freeze({});
  const { review, verify } = service;
  const input = asynchronous ? z.custom<Evidence>().check(async () => {}) : z.custom<Evidence>();
  function reject(): never { throw new z.ZodError([{ code: 'custom', path: [], message: 'Review refused' }]); }
  function document(input: unknown): Readonly<Document> {
    return Object.freeze(DocumentSchema.parse(input));
  }
  function verified(input: unknown) {
    const evidence = EvidenceSchema.parse(input);
    Object.freeze(evidence.document); Object.freeze(evidence);
    const result = verify(evidence);
    if (!result.ok) return reject();
    return { data: document(result.subject), evidence };
  }
  class Reviewed {
    #data: Readonly<Document>;
    #wire: Evidence;
    private constructor(key: object, data: Readonly<Document>, wire: Evidence) {
      if (key !== token) throw new TypeError('Private construction');
      this.#data = data; this.#wire = wire; Object.freeze(this);
    }
    static is(value: unknown): value is Reviewed { return typeof value === 'object' && value !== null && #data in value; }
    static read(value: Reviewed): Readonly<Document> { return value.#data; }
    static encode(value: Reviewed): Evidence { return value.#wire; }
    static async establish(input: unknown): Promise<Reviewed> {
      const data = document(input);
      const result = await review(data);
      if (!result.ok) return reject();
      const checked = verified(result.evidence);
      if (data.title !== checked.data.title || data.body !== checked.data.body) return reject();
      return new Reviewed(token, data, checked.evidence);
    }
    toJSON(): Evidence { return this.#wire; }
    static readonly codec = z.codec(input, z.custom<Reviewed>().check(ctx => {
      if (!Reviewed.is(ctx.value)) ctx.issues.push({ code: 'custom', input: undefined, message: 'Expected local reviewed document' });
    }), {
      decode(input, ctx) {
        function construct() {
          try { const checked = verified(input); return new Reviewed(token, checked.data, checked.evidence); }
          catch (error) {
            if (!(error instanceof z.ZodError)) throw error;
            ctx.issues.push({ code: 'custom', input: undefined, message: 'Invalid review evidence' }); return z.NEVER;
          }
        }
        return asynchronous ? Promise.resolve().then(construct) : construct();
      },
      encode(value, ctx) {
        if (!Reviewed.is(value)) { ctx.issues.push({ code: 'custom', input: undefined, message: 'Expected local reviewed document' }); return z.NEVER; }
        return value.#wire;
      },
    });
  }
  Object.freeze(Reviewed.prototype);
  return Object.freeze(Reviewed);
}
const requestToken = Object.freeze({});
export class NativeCheckedRequest {
  #data: Readonly<z.output<typeof RequestSchema>>;
  private constructor(token: object, data: Readonly<z.output<typeof RequestSchema>>) {
    if (token !== requestToken) throw new TypeError('Private construction');
    this.#data = data; Object.freeze(this);
  }
  static is(value: unknown): value is NativeCheckedRequest { return typeof value === 'object' && value !== null && #data in value; }
  static read(value: NativeCheckedRequest) { return value.#data; }
  static async establish(input: unknown): Promise<NativeCheckedRequest> {
    const data = Object.freeze(RequestSchema.parse(input));
    const decision = checkRequest(data);
    if (!decision.ok) throw new z.ZodError([{ code: 'custom', path: [], message: 'Entry checks refused' }]);
    return new NativeCheckedRequest(requestToken, data);
  }
  static readonly valueSchema = z.custom<NativeCheckedRequest>(NativeCheckedRequest.is);
  toJSON(): never { throw new TypeError('Local-only value'); }
}

Object.freeze(NativeCheckedRequest.prototype);
Object.freeze(NativeCheckedRequest);
