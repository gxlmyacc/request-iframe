import { generateRequestId } from '../../utils';
import { isAckMatch } from '../../utils/ack';

/**
 * Build the expected ack payload for requireAck workflows.
 *
 * - If `ack` is provided, it wins.
 * - If `requireAck` is true and ack not provided, generate `{ id }`.
 * - Otherwise return undefined.
 */
export function buildExpectedAck(requireAck: boolean, ack?: any): any {
  if (ack !== undefined) return ack;
  if (!requireAck) return undefined;
  return { id: generateRequestId() };
}

/**
 * Check whether received ack matches expected.
 *
 * If expected is undefined, treat as "no matching required" and return true.
 */
export function isExpectedAckMatch(expectedAck: any, receivedAck: any): boolean {
  if (expectedAck === undefined) return true;
  return isAckMatch(expectedAck, receivedAck);
}

