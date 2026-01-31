import { isAckMetaEqual } from '../utils/ack-meta';

describe('utils/ack-meta', () => {
  it('should handle primitives and Object.is edge cases', () => {
    expect(isAckMetaEqual(1, 1)).toBe(true);
    expect(isAckMetaEqual(1, 2)).toBe(false);
    expect(isAckMetaEqual('a', 'a')).toBe(true);
    expect(isAckMetaEqual('a', 'b')).toBe(false);
    /** NaN: NaN !== NaN, but Object.is(NaN, NaN) === true */
    expect(isAckMetaEqual(Number.NaN, Number.NaN)).toBe(true);
  });

  it('should handle null/undefined and type mismatch', () => {
    expect(isAckMetaEqual(null, null)).toBe(true);
    expect(isAckMetaEqual(undefined, undefined)).toBe(true);
    expect(isAckMetaEqual(null, undefined)).toBe(false);
    expect(isAckMetaEqual(1, '1')).toBe(false);
  });

  it('should compare arrays (shape/length/value) and nested arrays', () => {
    expect(isAckMetaEqual([1, 2], [1, 2])).toBe(true);
    expect(isAckMetaEqual([1, 2], [1, 3])).toBe(false);
    expect(isAckMetaEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(isAckMetaEqual([1, 2] as any, { 0: 1, 1: 2 } as any)).toBe(false);
    expect(isAckMetaEqual([[1], [2, 3]], [[1], [2, 3]])).toBe(true);
  });

  it('should only support plain objects (prototype must be Object.prototype)', () => {
    expect(isAckMetaEqual(new Date(0) as any, new Date(0) as any)).toBe(false);
    class X { public x = 1; }
    expect(isAckMetaEqual(new X() as any, new X() as any)).toBe(false);
  });

  it('should compare plain objects by keyset and deep values', () => {
    expect(isAckMetaEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(isAckMetaEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(isAckMetaEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(isAckMetaEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(isAckMetaEqual({ a: { b: [1, 2] } }, { a: { b: [1, 2] } })).toBe(true);
    expect(isAckMetaEqual({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toBe(false);
  });
});

