import { requestIframeEndpoint } from '../src/api/endpoint';
import { createPostMessage } from '../src/utils/protocol';
import { MessageType, MessageRole, OriginConstant } from '../src/constants';
import { RequestIframeEndpointFacade } from '../src/endpoint/facade';
import { RequestIframeEndpointHub } from '../src/endpoint/infra/hub';
import { RequestIframeEndpointHeartbeat } from '../src/endpoint/heartbeat/heartbeat';
import { createPingResponder } from '../src/endpoint/heartbeat/ping';
import { buildExpectedAck, isExpectedAckMatch } from '../src/message/ack';
import { buildStreamStartTimeoutErrorPayload } from '../src/endpoint/stream/errors';
import { parseStreamStart, createReadableStreamFromStart } from '../src/endpoint/stream/factory';
import { autoResolveIframeFileReadableStream, parseFilenameFromContentDisposition } from '../src/endpoint/stream/file-auto-resolve';
import { ServerRequestImpl } from '../src/impl/request';
import { IframeFileWritableStream, IframeFileReadableStream } from '../src/stream/file-stream';
import type { StreamMessageHandler } from '../src/stream';
import { setupRequestIframeTestEnv, createTestIframe, cleanupIframe } from './test-utils/request-iframe';

setupRequestIframeTestEnv();

describe('coverage: api/endpoint + endpoint helpers', () => {
  it('requestIframeEndpoint: window target + targetOrigin override + id override + open/close/destroy', () => {
    const endpoint = requestIframeEndpoint(window, {
      id: 'ep1',
      autoOpen: false,
      targetOrigin: 'https://example.com'
    });

    /** Facade open state only (lazy) */
    expect(endpoint.id).toBe('ep1');
    expect(endpoint.isOpen).toBe(false);

    endpoint.open();
    expect(endpoint.isOpen).toBe(true);

    endpoint.close();
    expect(endpoint.isOpen).toBe(false);

    endpoint.destroy();
  });

  it('requestIframeEndpoint: iframe not ready throws', () => {
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'contentWindow', {
      value: null,
      writable: true,
      configurable: true
    });

    expect(() => requestIframeEndpoint(iframe)).toThrow();
  });

  it('requestIframeEndpoint: lazy create client/server via getters', () => {
    const iframe = createTestIframe('https://example.com');
    Object.defineProperty(iframe, 'contentWindow', {
      value: window,
      writable: true,
      configurable: true
    });

    const endpoint = requestIframeEndpoint(iframe, { autoOpen: true, trace: false });

    /** Touch both sides */
    expect((endpoint as any).client).toBeDefined();
    expect((endpoint as any).server).toBeDefined();

    endpoint.destroy();
    cleanupIframe(iframe);
  });

  it('buildExpectedAck/isExpectedAckMatch branches', () => {
    const a1 = buildExpectedAck(false);
    expect(a1).toBeUndefined();

    const a2 = buildExpectedAck(true, { id: 'x' });
    expect(a2).toEqual({ id: 'x' });

    const a3 = buildExpectedAck(true);
    expect(a3).toBeDefined();

    expect(isExpectedAckMatch(undefined, { id: 'any' })).toBe(true);
    expect(isExpectedAckMatch({ id: 'a' }, { id: 'a' })).toBe(true);
    expect(isExpectedAckMatch({ id: 'a' }, { id: 'b' })).toBe(false);
  });

  it('buildStreamStartTimeoutErrorPayload branches', () => {
    const payload = buildStreamStartTimeoutErrorPayload({
      path: '/p',
      timeoutMs: 123,
      requireAck: true,
      ack: { id: 'a' },
      targetId: 't'
    });
    expect(payload.path).toBe('/p');
    expect(payload.error?.code).toBeDefined();
    expect(payload.requireAck).toBe(true);
    expect((payload as any).ack).toEqual({ id: 'a' });
    expect(payload.targetId).toBe('t');
  });

  it('parseStreamStart/createReadableStreamFromStart branches', () => {
    expect(parseStreamStart(null)).toBeNull();
    expect(parseStreamStart({})).toBeNull();

    const handler: StreamMessageHandler = {
      registerStreamHandler: jest.fn(),
      unregisterStreamHandler: jest.fn(),
      postMessage: jest.fn()
    };

    const data1 = createPostMessage(MessageType.STREAM_START, 'r1', {
      role: MessageRole.SERVER,
      body: { streamId: 's1', type: 'data', chunked: false, autoResolve: true }
    });
    const created1 = createReadableStreamFromStart({
      requestId: 'r1',
      data: data1,
      handler,
      secretKey: 'sk1',
      idleTimeout: 10,
      heartbeat: async () => true
    });
    expect(created1).toBeTruthy();
    expect(created1!.info.streamId).toBe('s1');
    expect(created1!.info.chunked).toBe(false);
    expect(created1!.info.autoResolve).toBe(true);

    const data2 = createPostMessage(MessageType.STREAM_START, 'r2', {
      role: MessageRole.SERVER,
      secretKey: 'sk2',
      body: { streamId: 's2', type: 'file', metadata: { filename: 'a.txt' } }
    });
    const created2 = createReadableStreamFromStart({
      requestId: 'r2',
      data: data2,
      handler
    });
    expect(created2).toBeTruthy();
    expect(created2!.info.type).toBe('file');
  });

  it('file-auto-resolve branches', async () => {
    expect(parseFilenameFromContentDisposition()).toBeUndefined();
    expect(parseFilenameFromContentDisposition('attachment')).toBeUndefined();
    expect(parseFilenameFromContentDisposition('attachment; filename="a.txt"')).toBe('a.txt');
    expect(parseFilenameFromContentDisposition(['attachment; filename=b.txt'])).toBe('b.txt');

    const fileStream: any = {
      filename: 'stream.txt',
      readAsFile: jest.fn(async () => new File([], 'x.txt')),
      readAsBlob: jest.fn(async () => new Blob([]))
    };

    /** Header filename wins */
    await autoResolveIframeFileReadableStream({
      fileStream,
      info: { streamId: 's', type: 'file', chunked: true, autoResolve: true, metadata: { filename: 'meta.txt' } } as any,
      headers: { 'Content-Disposition': 'attachment; filename="hdr.txt"' }
    });
    expect(fileStream.readAsFile).toHaveBeenCalledWith('hdr.txt');

    /** Metadata filename wins when header missing */
    fileStream.readAsFile.mockClear();
    await autoResolveIframeFileReadableStream({
      fileStream,
      info: { streamId: 's', type: 'file', chunked: true, autoResolve: true, metadata: { filename: 'meta.txt' } } as any,
      headers: {}
    });
    expect(fileStream.readAsFile).toHaveBeenCalledWith('meta.txt');

    /** Fallback to stream.filename */
    fileStream.readAsFile.mockClear();
    await autoResolveIframeFileReadableStream({ fileStream, info: null, headers: {} });
    expect(fileStream.readAsFile).toHaveBeenCalledWith('stream.txt');

    /** No filename -> readAsBlob */
    const fileStream2: any = {
      filename: undefined,
      readAsFile: jest.fn(async () => new File([], 'x.txt')),
      readAsBlob: jest.fn(async () => new Blob([]))
    };
    await autoResolveIframeFileReadableStream({ fileStream: fileStream2, info: null, headers: {} });
    expect(fileStream2.readAsBlob).toHaveBeenCalled();
  });
});

describe('coverage: endpoint/heartbeat + ping responder', () => {
  it('createPingResponder branches', () => {
    const hub: any = {
      messageDispatcher: { sendMessage: jest.fn() }
    };

    const responder = createPingResponder({ hub, handledBy: 'h1', includeTargetId: true });
    const attachCtx = (c: any) => {
      c.markHandledBy = (handledBy: string) => {
        if (!c.handledBy) c.handledBy = handledBy;
      };
      c.markAcceptedBy = (handledBy: string) => {
        if (!c.acceptedBy) c.acceptedBy = handledBy;
        c.markHandledBy(handledBy);
      };
      c.markDoneBy = (doneBy: string) => {
        c.doneBy = doneBy;
      };
      c.getStage = () => {
        if (c.doneBy) return 'done';
        if (c.acceptedBy) return 'accepted';
        if (c.handledBy) return 'handling';
        return 'pending';
      };
      return c;
    };

    const ctx1: any = attachCtx({ origin: OriginConstant.ANY, source: undefined, handledBy: undefined, acceptedBy: undefined });
    responder(createPostMessage(MessageType.PING, 'p1') as any, ctx1);
    expect(hub.messageDispatcher.sendMessage).not.toHaveBeenCalled();

    const ctx2: any = attachCtx({ origin: OriginConstant.ANY, source: window, handledBy: undefined, acceptedBy: undefined });
    responder(createPostMessage(MessageType.PING, 'p2', { creatorId: 'c1' }) as any, ctx2);
    expect(ctx2.acceptedBy).toBe('h1');
    expect(ctx2.handledBy).toBe('h1');
    expect(hub.messageDispatcher.sendMessage).toHaveBeenCalled();
  });

  it('RequestIframeEndpointHeartbeat: ping timeout + handlePong branches', async () => {
    jest.useFakeTimers();

    const pendingMaps = new Map<string, Map<string, any>>();
    const pending = {
      map: (name: string) => {
        const m = pendingMaps.get(name) ?? new Map<string, any>();
        pendingMaps.set(name, m);
        return m;
      },
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: any) => clearTimeout(id),
      set: (name: string, key: string, value: any) => pending.map(name).set(key, value),
      get: (name: string, key: string) => pending.map(name).get(key),
      delete: (name: string, key: string) => pending.map(name).delete(key)
    };

    const hub: any = { pending, isOpen: false };
    const warn = jest.fn();

    const hb = new RequestIframeEndpointHeartbeat({
      hub,
      pendingBucket: 'b',
      handledBy: 'h',
      isOriginAllowed: (d: any) => d.type !== 'block',
      warnMissingPendingWhenClosed: warn
    });

    /** pending missing -> warn when closed */
    hb.handlePong(createPostMessage(MessageType.PONG, 'nope', { role: MessageRole.CLIENT }) as any, { origin: OriginConstant.ANY } as any);
    expect(warn).toHaveBeenCalled();

    /** origin blocked */
    hb.handlePong(createPostMessage('block' as any, 'x') as any, { origin: OriginConstant.ANY } as any);

    /** ping timeout -> resolves false */
    const peer: any = { sendMessage: jest.fn() };
    const p = hb.ping(peer, 10);
    jest.advanceTimersByTime(20);
    await expect(p).resolves.toBe(false);

    jest.useRealTimers();
  });
});

describe('coverage: endpoint/facade branches (unit)', () => {
  it('buildOriginValidator branches + pingPeer without heartbeat', async () => {
    const f1 = new RequestIframeEndpointFacade({
      role: MessageRole.SERVER,
      instanceId: 's1'
    });
    expect(f1.originValidator).toBeUndefined();
    await expect(f1.pingPeer(window, OriginConstant.ANY, 1)).resolves.toBe(false);

    const f2 = new RequestIframeEndpointFacade({
      role: MessageRole.SERVER,
      instanceId: 's2',
      originValidator: { validateOrigin: () => false }
    });
    expect(f2.originValidator!('x', {} as any, {} as any)).toBe(false);

    const f3 = new RequestIframeEndpointFacade({
      role: MessageRole.SERVER,
      instanceId: 's3',
      originValidator: { allowedOrigins: 'https://example.com' }
    });
    expect(f3.originValidator!('https://example.com', {} as any, {} as any)).toBe(true);
    expect(f3.originValidator!('https://evil.com', {} as any, {} as any)).toBe(false);
  });

  it('registerIncomingStreamStartWaiter timeout branch', () => {
    jest.useFakeTimers();
    const f = new RequestIframeEndpointFacade({
      role: MessageRole.SERVER,
      instanceId: 's4'
    });
    const onTimeout = jest.fn();
    f.registerIncomingStreamStartWaiter({
      pendingBucket: 'pb',
      requestId: 'r1',
      streamId: 'st1',
      timeoutMs: 10,
      targetWindow: window,
      targetOrigin: OriginConstant.ANY,
      onTimeout,
      continue: jest.fn()
    });
    /** remove pending before timer fires => onTimeout not called */
    f.hub.pending.delete('pb', 'r1');
    jest.advanceTimersByTime(20);
    expect(onTimeout).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('handleStreamStart branches: role mismatch, missing pending when closed, streamId mismatch', () => {
    const f = new RequestIframeEndpointFacade({
      role: MessageRole.SERVER,
      instanceId: 's5'
    });

    const warn = jest.fn();

    /** role mismatch */
    f.handleStreamStart({
      data: createPostMessage(MessageType.STREAM_START, 'r0', { role: MessageRole.SERVER, body: { streamId: 'x' } }),
      context: { origin: OriginConstant.ANY } as any,
      expectedRole: MessageRole.CLIENT,
      pendingBucket: 'pb',
      warnMissingPendingWhenClosed: warn
    });

    /** closed + missing pending => warn */
    f.hub.close();
    f.handleStreamStart({
      data: createPostMessage(MessageType.STREAM_START, 'r1', { role: MessageRole.CLIENT, body: { streamId: 'x' } }),
      context: { origin: OriginConstant.ANY } as any,
      expectedRole: MessageRole.CLIENT,
      pendingBucket: 'pb',
      warnMissingPendingWhenClosed: warn
    });
    expect(warn).toHaveBeenCalled();

    /** open + pending exists but streamId mismatch => ignore */
    f.hub.open();
    f.hub.pending.set('pb', 'r2', {
      streamId: 'expect',
      timeoutId: setTimeout(() => void 0, 1),
      targetWindow: window,
      targetOrigin: OriginConstant.ANY,
      continue: jest.fn()
    });
    f.handleStreamStart({
      data: createPostMessage(MessageType.STREAM_START, 'r2', { role: MessageRole.CLIENT, body: { streamId: 'actual' } }),
      context: { origin: OriginConstant.ANY } as any,
      expectedRole: MessageRole.CLIENT,
      pendingBucket: 'pb'
    });
  });
});

describe('coverage: misc low-branch modules', () => {
  it('RequestIframeEndpointHub.isOriginAllowedBy branches', () => {
    const hub = new RequestIframeEndpointHub(MessageRole.CLIENT, 'c1');
    const data: any = createPostMessage(MessageType.RESPONSE, 'r', { role: MessageRole.SERVER });
    const ctx: any = { origin: 'https://a.com' };

    expect(hub.isOriginAllowedBy(ctx.origin, data, ctx, OriginConstant.ANY)).toBe(true);
    expect(hub.isOriginAllowedBy(ctx.origin, data, ctx, 'https://a.com')).toBe(true);
    expect(hub.isOriginAllowedBy(ctx.origin, data, ctx, 'https://b.com')).toBe(false);
    expect(hub.isOriginAllowedBy(ctx.origin, data, ctx, undefined, () => { throw new Error('x'); })).toBe(false);
  });

  it('ServerRequestImpl branches (headers array join, defaults)', () => {
    const data: any = createPostMessage(MessageType.REQUEST, 'r1', {
      role: MessageRole.CLIENT,
      path: undefined,
      headers: { a: ['1', '2'], b: 'x' },
      cookies: undefined
    });
    const ctx: any = { origin: 'https://o', source: window };
    const res: any = {};
    const req = new ServerRequestImpl(data, ctx, res);
    expect(req.headers.a).toBe('1, 2');
    expect(req.headers.b).toBe('x');
    expect(req.cookies).toEqual({});
    expect(req.path).toBe('');
  });

  it('IframeFileStream encode/decode/merge branches', () => {
    class TestFileWritableStream extends IframeFileWritableStream {
      public _encode(d: any) {
        return this.encodeData(d);
      }
    }
    const w = new TestFileWritableStream({ filename: 'f', mimeType: 'text/plain', next: async () => ({ data: '', done: true }) });
    expect(typeof w._encode(new Uint8Array([1, 2, 3]))).toBe('object');
    expect(typeof w._encode(new ArrayBuffer(2))).toBe('object');
    expect(w._encode('abc')).toBeInstanceOf(Uint8Array);
    expect(Array.from(w._encode('abc') as Uint8Array)).toEqual(Array.from(Uint8Array.from(Buffer.from('abc', 'utf8'))));
    expect(w._encode(123 as any)).toBeInstanceOf(Uint8Array);
    expect(Array.from(w._encode(123 as any) as Uint8Array)).toEqual(
      Array.from(Uint8Array.from(Buffer.from('123', 'utf8')))
    );

    const handler: StreamMessageHandler = { registerStreamHandler: jest.fn(), unregisterStreamHandler: jest.fn(), postMessage: jest.fn() };
    class TestFileReadableStream extends IframeFileReadableStream {
      public _decode(d: any) {
        return this.decodeData(d);
      }
      public _merge() {
        return this.mergeChunks();
      }
    }
    const r = new TestFileReadableStream('s', 'r', handler, {});
    expect(r._decode('YQ==') instanceof Uint8Array).toBe(true);
    expect(r._decode(new Uint8Array([1])) instanceof Uint8Array).toBe(true);
    expect(r._decode(new ArrayBuffer(1)) instanceof Uint8Array).toBe(true);
    expect(r._decode(1 as any) instanceof Uint8Array).toBe(true);

    (r as any).chunks = [];
    expect(r._merge().byteLength).toBe(0);
    (r as any).chunks = [new Uint8Array([1, 2])];
    expect(r._merge().byteLength).toBe(2);
    (r as any).chunks = [new Uint8Array([1]), new Uint8Array([2, 3])];
    expect(r._merge().byteLength).toBe(3);
  });
});

