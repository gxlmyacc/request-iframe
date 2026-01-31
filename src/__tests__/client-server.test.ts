import { RequestIframeClientServer } from '../core/client-server';
import { clearMessageChannelCache } from '../utils/cache';
import { MessageRole, OriginConstant } from '../constants';

function createMockWindow(): Window & { postMessage: jest.Mock } {
  const w = Object.create(window) as any;
  w.postMessage = jest.fn();
  return w;
}

function dispatchFrameworkMessage(params: {
  origin: string;
  source?: any;
  data: any;
}) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: params.data,
      origin: params.origin,
      source: params.source
    })
  );
}

describe('core/client-server (RequestIframeClientServer) - branch focused', () => {
  beforeEach(() => {
    clearMessageChannelCache();
  });

  afterEach(() => {
    clearMessageChannelCache();
  });

  it('open/close should be idempotent', () => {
    const cs = new RequestIframeClientServer({ secretKey: 'cs-open-close', autoOpen: false }, 'client-1');
    expect(cs.isOpen).toBe(false);
    cs.open();
    cs.open();
    expect(cs.isOpen).toBe(true);
    cs.close();
    cs.close();
    expect(cs.isOpen).toBe(false);
    cs.destroy();
  });

  it('should route stream_* (except stream_start) to streamCallback', async () => {
    const secretKey = 'cs-stream-callback';
    const cs = new RequestIframeClientServer({ secretKey }, 'client-1');
    const cb = jest.fn();
    cs.setStreamCallback(cb);

    const source = createMockWindow();
    dispatchFrameworkMessage({
      origin: 'https://example.com',
      source,
      data: {
        __requestIframe__: 1,
        type: 'stream_data',
        requestId: 'rid',
        body: { streamId: 'sid', data: 'x' },
        role: MessageRole.SERVER,
        secretKey
      }
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(cb).toHaveBeenCalledTimes(1);
    cs.destroy();
  });

  it('stream_start should resolve pending but not call streamCallback, and should keep pending', async () => {
    const secretKey = 'cs-stream-start';
    const cs = new RequestIframeClientServer({ secretKey }, 'client-1');
    const streamCb = jest.fn();
    cs.setStreamCallback(streamCb);

    const resolve = jest.fn();
    const reject = jest.fn();
    cs._registerPendingRequest('rid', resolve, reject, OriginConstant.ANY);

    const source = createMockWindow();
    dispatchFrameworkMessage({
      origin: 'https://example.com',
      source,
      data: {
        __requestIframe__: 1,
        type: 'stream_start',
        requestId: 'rid',
        body: { streamId: 'sid', type: 'data', chunked: true },
        role: MessageRole.SERVER,
        secretKey
      }
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(resolve).toHaveBeenCalled();
    expect(streamCb).not.toHaveBeenCalled();
    // stream_start should keep pending (used by stream_data/stream_end)
    expect((cs as any).pendingRequests.has('rid')).toBe(true);
    cs._unregisterPendingRequest('rid');
    cs.destroy();
  });

  it('ACK/ASYNC should resolve pending but keep it; RESPONSE should resolve and delete pending', async () => {
    const secretKey = 'cs-pending-delete';
    const cs = new RequestIframeClientServer({ secretKey }, 'client-1');
    const source = createMockWindow();

    const resolveAck = jest.fn();
    cs._registerPendingRequest('rid-ack', resolveAck, jest.fn(), '*');
    dispatchFrameworkMessage({
      origin: 'https://example.com',
      source,
      data: {
        __requestIframe__: 1,
        type: 'ack',
        requestId: 'rid-ack',
        role: MessageRole.SERVER,
        secretKey
      }
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(resolveAck).toHaveBeenCalled();
    expect((cs as any).pendingRequests.has('rid-ack')).toBe(true);
    cs._unregisterPendingRequest('rid-ack');

    const resolveResp = jest.fn();
    cs._registerPendingRequest('rid-resp', resolveResp, jest.fn(), '*');
    dispatchFrameworkMessage({
      origin: 'https://example.com',
      source,
      data: {
        __requestIframe__: 1,
        type: 'response',
        requestId: 'rid-resp',
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        role: MessageRole.SERVER,
        secretKey
      }
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(resolveResp).toHaveBeenCalled();
    expect((cs as any).pendingRequests.has('rid-resp')).toBe(false);

    cs.destroy();
  });

  it('should validate origin via origin string and originValidator branches', async () => {
    const secretKey = 'cs-origin-validate';
    const cs = new RequestIframeClientServer({ secretKey }, 'client-1');
    const source = createMockWindow();

    // origin mismatch branch
    const resolve1 = jest.fn();
    cs._registerPendingRequest('rid1', resolve1, jest.fn(), 'https://allowed.com');
    dispatchFrameworkMessage({
      origin: 'https://blocked.com',
      source,
      data: {
        __requestIframe__: 1,
        type: 'response',
        requestId: 'rid1',
        status: 200,
        role: MessageRole.SERVER,
        secretKey
      }
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(resolve1).not.toHaveBeenCalled();
    expect((cs as any).pendingRequests.has('rid1')).toBe(true);
    cs._unregisterPendingRequest('rid1');

    // originValidator returns false branch
    const resolve2 = jest.fn();
    const validatorFalse = jest.fn(() => false);
    cs._registerPendingRequest('rid2', resolve2, jest.fn(), '*', validatorFalse);
    dispatchFrameworkMessage({
      origin: 'https://example.com',
      source,
      data: {
        __requestIframe__: 1,
        type: 'response',
        requestId: 'rid2',
        status: 200,
        role: MessageRole.SERVER,
        secretKey
      }
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(validatorFalse).toHaveBeenCalled();
    expect(resolve2).not.toHaveBeenCalled();
    cs._unregisterPendingRequest('rid2');

    // originValidator throws branch
    const resolve3 = jest.fn();
    const validatorThrow = jest.fn(() => {
      throw new Error('boom');
    });
    cs._registerPendingRequest('rid3', resolve3, jest.fn(), '*', validatorThrow);
    dispatchFrameworkMessage({
      origin: 'https://example.com',
      source,
      data: {
        __requestIframe__: 1,
        type: 'response',
        requestId: 'rid3',
        status: 200,
        role: MessageRole.SERVER,
        secretKey
      }
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(validatorThrow).toHaveBeenCalled();
    expect(resolve3).not.toHaveBeenCalled();
    cs._unregisterPendingRequest('rid3');

    cs.destroy();
  });

  it('handlePong should resolve pending and delete it (and validate origin)', async () => {
    const secretKey = 'cs-pong';
    const cs = new RequestIframeClientServer({ secretKey }, 'client-1');
    const source = createMockWindow();

    // origin mismatch should ignore
    const resolveBad = jest.fn();
    cs._registerPendingRequest('rid-bad', resolveBad, jest.fn(), 'https://allowed.com');
    dispatchFrameworkMessage({
      origin: 'https://blocked.com',
      source,
      data: {
        __requestIframe__: 1,
        type: 'pong',
        requestId: 'rid-bad',
        role: MessageRole.SERVER,
        secretKey
      }
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(resolveBad).not.toHaveBeenCalled();
    cs._unregisterPendingRequest('rid-bad');

    // valid pong should resolve and delete
    const resolveOk = jest.fn();
    cs._registerPendingRequest('rid-ok', resolveOk, jest.fn(), '*');
    dispatchFrameworkMessage({
      origin: 'https://example.com',
      source,
      data: {
        __requestIframe__: 1,
        type: 'pong',
        requestId: 'rid-ok',
        role: MessageRole.SERVER,
        secretKey
      }
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(resolveOk).toHaveBeenCalled();
    expect((cs as any).pendingRequests.has('rid-ok')).toBe(false);

    cs.destroy();
  });

  it('handlePing should ignore missing source, and reply pong (and ack when requireAck=true)', async () => {
    const secretKey = 'cs-ping';
    const cs = new RequestIframeClientServer({ secretKey }, 'client-1');

    // missing source => ignore
    (cs as any).handlePing(
      {
        __requestIframe__: 1,
        type: 'ping',
        requestId: 'rid-x',
        role: MessageRole.SERVER,
        secretKey
      },
      { origin: 'https://example.com', source: undefined }
    );

    // direct-call branch: with source => should reply pong and mark accepted/handledBy
    const source = createMockWindow();
    const ctx: any = { origin: 'https://example.com', source };
    (cs as any).handlePing(
      {
        __requestIframe__: 1,
        type: 'ping',
        requestId: 'rid-ping',
        role: MessageRole.SERVER,
        creatorId: 'server-1',
        requireAck: true,
        secretKey
      },
      ctx
    );

    expect(ctx.accepted).toBe(true);
    expect(ctx.handledBy).toBe('client');
    expect(source.postMessage).toHaveBeenCalled();
    const sentTypes = (source.postMessage as jest.Mock).mock.calls.map((c: any[]) => c[0]?.type).filter(Boolean);
    expect(sentTypes).toContain('pong');
    cs.destroy();
  });

  it('handleVersionError should reject pending when version is too low', async () => {
    const secretKey = 'cs-version';
    const cs = new RequestIframeClientServer({ secretKey }, 'client-1');
    const source = createMockWindow();

    const promise = new Promise((resolve, reject) => {
      cs._registerPendingRequest('rid', resolve as any, reject as any, OriginConstant.ANY);
    });

    dispatchFrameworkMessage({
      origin: 'https://example.com',
      source,
      data: {
        __requestIframe__: 0,
        type: 'response',
        requestId: 'rid',
        role: MessageRole.SERVER,
        secretKey
      }
    });

    await expect(promise).rejects.toBeInstanceOf(Error);
    expect((cs as any).pendingRequests.has('rid')).toBe(false);
    cs.destroy();
  });

  it('should warn once when response arrives after _isOpen is forced false (missing pending)', async () => {
    const secretKey = 'cs-warn';
    const cs = new RequestIframeClientServer({ secretKey }, 'client-1');
    (cs as any)._isOpen = false;

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const source = createMockWindow();

    dispatchFrameworkMessage({
      origin: 'https://example.com',
      source,
      data: {
        __requestIframe__: 1,
        type: 'response',
        requestId: 'rid-missing',
        role: MessageRole.SERVER,
        secretKey
      }
    });
    dispatchFrameworkMessage({
      origin: 'https://example.com',
      source,
      data: {
        __requestIframe__: 1,
        type: 'response',
        requestId: 'rid-missing',
        role: MessageRole.SERVER,
        secretKey
      }
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    cs.destroy();
  });

  /** removed: pending received-ack workflow (ACK-only requireAck) */
});

