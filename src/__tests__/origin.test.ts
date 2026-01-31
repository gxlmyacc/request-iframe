import { matchOrigin } from '../utils/origin';
import { OriginConstant } from '../constants';

describe('utils/origin', () => {
  it('should match "*" (allow all)', () => {
    expect(matchOrigin('https://a.com', OriginConstant.ANY)).toBe(true);
  });

  it('should match exact string origin', () => {
    expect(matchOrigin('https://a.com', 'https://a.com')).toBe(true);
    expect(matchOrigin('https://a.com', 'https://b.com')).toBe(false);
  });

  it('should match RegExp', () => {
    expect(matchOrigin('https://a.com', /^https:\/\/a\.com$/)).toBe(true);
    expect(matchOrigin('https://a.com', /^https:\/\/b\.com$/)).toBe(false);
  });

  it('should match Array (any-of) with recursion', () => {
    expect(matchOrigin('https://a.com', ['https://b.com', /^https:\/\/a\.com$/])).toBe(true);
    expect(matchOrigin('https://a.com', ['https://b.com', /^https:\/\/c\.com$/])).toBe(false);
    expect(matchOrigin('https://a.com', ['https://b.com', OriginConstant.ANY])).toBe(true);
  });

  it('should return false for unknown matcher types (defensive)', () => {
    expect(matchOrigin('https://a.com', ({ x: 1 } as any))).toBe(false);
  });
});

