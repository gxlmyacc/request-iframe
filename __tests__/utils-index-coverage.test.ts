import { detectContentType } from '../src/utils';

describe('coverage: utils/index detectContentType', () => {
  it('should handle URLSearchParams/FormData branches', () => {
    /** URLSearchParams should not auto-set JSON */
    // eslint-disable-next-line no-undef
    const usp = typeof URLSearchParams !== 'undefined' ? new URLSearchParams('a=1') : (null as any);
    if (usp) {
      expect(detectContentType(usp)).toBe('application/x-www-form-urlencoded');
    }

    /** FormData should not auto-set JSON */
    // eslint-disable-next-line no-undef
    const fd = typeof FormData !== 'undefined' ? new FormData() : (null as any);
    if (fd) {
      expect(detectContentType(fd)).toBeNull();
    }
  });
});

