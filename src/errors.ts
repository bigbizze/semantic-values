/** An expected rejection of semantic input. Parsers may throw this instead of a generic TypeError. */
export class SemanticValidationError extends TypeError { readonly code = '@bigbizze/semantic-values/validation'; }
/** An expected rejection of input beyond the supported snapshot depth. */
export class SemanticDepthError extends RangeError { readonly code = '@bigbizze/semantic-values/depth'; }
