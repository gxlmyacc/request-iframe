import { getAckId, getAckMeta, isAckMatch } from '../utils/ack';

describe('utils/ack-meta', () => {
  it('getAckMetaId should extract id only', () => {
    expect(getAckId(undefined)).toBeUndefined();
    expect(getAckId(null)).toBeUndefined();
    expect(getAckId({})).toBeUndefined();
    expect(getAckId({ id: 'x', extra: 1 })).toBe('x');
    expect(getAckId({ id: 1, extra: { big: '...' } })).toBe(1);
    expect(getAckId({ id: true } as any)).toBeUndefined();
  });

  it('getAckMeta should extract meta only when string', () => {
    expect(getAckMeta(undefined)).toBeUndefined();
    expect(getAckMeta(null)).toBeUndefined();
    expect(getAckMeta({})).toBeUndefined();
    expect(getAckMeta({ id: 'x', meta: 'm' })).toBe('m');
    expect(getAckMeta({ id: 'x', meta: 123 } as any)).toBeUndefined();
  });

  it('isAckMetaMatch should match by id only (ignore other fields)', () => {
    expect(isAckMatch(undefined, undefined)).toBe(true);
    expect(isAckMatch({ id: 'x', big: 'a'.repeat(1000) }, { id: 'x' })).toBe(true);
    expect(isAckMatch({ id: 'x' }, { id: 'y' })).toBe(false);
    expect(isAckMatch({ id: 'x' }, undefined)).toBe(false);
  });

  /** ack payload echo is sender-controlled; no forced reduction */
});

