/**
 * ack is an internal reserved protocol field (previously named ackMeta).
 *
 * Semantics (ACK-only workflow):
 * - If `ack` exists, it should contain a required `id` (string|number) for matching.
 * - Fixed shape: { id, meta?: string } (meta is optional and must be a string if present).
 * - Matching is by `id` only; never deep-compare other fields.
 *
 * @internal
 */
export function getAckId(ack: any): string | number | undefined {
  if (!ack || typeof ack !== 'object') return undefined;
  const id = (ack as any).id;
  return typeof id === 'string' || typeof id === 'number' ? id : undefined;
}

/**
 * @internal
 */
export function getAckMeta(ack: any): string | undefined {
  if (!ack || typeof ack !== 'object') return undefined;
  const meta = (ack as any).meta;
  return typeof meta === 'string' ? meta : undefined;
}

/**
 * Match ack by `id` only.
 * @internal
 */
export function isAckMatch(expected: any, received: any): boolean {
  if (expected === undefined) return true;
  const expectedId = getAckId(expected);
  const receivedId = getAckId(received);
  if (expectedId === undefined || receivedId === undefined) return false;
  return expectedId === receivedId;
}

