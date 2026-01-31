/**
 * Deep equality for ackMeta matching (safe subset).
 *
 * Rules:
 * - Supports primitives, arrays, and plain objects.
 * - Does not support functions, class instances, Maps/Sets, or cyclic references.
 *
 * @internal
 */
export function isAckMetaEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;

  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return false;

  if (ta !== 'object') {
    // number/string/boolean/symbol/bigint
    return Object.is(a, b);
  }

  // Arrays
  const aa = Array.isArray(a);
  const ab = Array.isArray(b);
  if (aa || ab) {
    if (!aa || !ab) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isAckMetaEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // Plain objects
  const pa = Object.getPrototypeOf(a);
  const pb = Object.getPrototypeOf(b);
  if (pa !== Object.prototype || pb !== Object.prototype) {
    return false;
  }

  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  // Key set equality
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
  }
  // Value equality
  for (const k of ka) {
    if (!isAckMetaEqual(a[k], b[k])) return false;
  }
  return true;
}

