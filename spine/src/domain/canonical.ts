/**
 * JSON Canonicalization Scheme, RFC 8785.
 *
 * The chain is computed over canonical bytes, so two implementations that agree on the value of an
 * event agree on its digest. In JavaScript the scheme reduces to: serialise primitives exactly as
 * `JSON.stringify` does (RFC 8785 §3.2.2–3.2.3 are defined in terms of ECMAScript's own number and
 * string serialisation), emit arrays in order, and emit object members sorted by the UTF-16 code
 * units of their names — which is what the default string comparison does.
 *
 * Written here rather than imported: the verifier ships as the exit deliverable and should depend
 * on as little as possible.
 */

export function canonicalize(value: unknown): string {
  if (value === undefined) throw new TypeError('JCS: undefined has no canonical form');
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('JCS: non-finite numbers have no canonical form');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'bigint':
      throw new TypeError('JCS: bigint is not JSON');
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v) => (v === undefined ? 'null' : canonicalize(v))).join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      const members = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`);
      return `{${members.join(',')}}`;
    }
    default:
      throw new TypeError(`JCS: ${typeof value} is not JSON`);
  }
}
