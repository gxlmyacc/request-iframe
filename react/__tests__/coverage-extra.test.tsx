import { renderHook } from '@testing-library/react';
import { useClient, useServerHandler, useServerHandlerMap } from '../src/index';

describe('coverage: react/src/index branch extras', () => {
  it('useServerHandler should be a noop when server is null', () => {
    expect(() => {
      renderHook(() => useServerHandler(null as any, '/p', () => void 0, []));
    }).not.toThrow();
  });

  it('useServerHandlerMap should be a noop when server is null', () => {
    expect(() => {
      renderHook(() => useServerHandlerMap(null as any, { '/p': () => void 0 }, []));
    }).not.toThrow();
  });

  it('deps optional branch: deps undefined should be handled', () => {
    expect(() => {
      renderHook(() => useServerHandler(null as any, '/p', () => void 0, undefined as any));
      renderHook(() => useServerHandlerMap(null as any, { '/p': () => void 0 }, undefined as any));
    }).not.toThrow();
  });

  it('useClient destroy should handle null clientRef.current', () => {
    const { unmount } = renderHook(() => useClient(() => null));
    expect(() => unmount()).not.toThrow();
  });
});

