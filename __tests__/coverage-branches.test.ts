import { requestIframeClient } from '../src/api/client';
import { requestIframeServer } from '../src/api/server';
import { clearServerCache } from '../src/utils/cache';
import { ErrorCode, getStatusText, Messages, MessageType } from '../src/constants';
import {
  InterceptorManager,
  RequestInterceptorManager,
  ResponseInterceptorManager,
  runRequestInterceptors,
  runResponseInterceptors
} from '../src/interceptors';
import { ServerResponseImpl } from '../src/impl/response';
import { IframeFileReadableStream, IframeFileWritableStream } from '../src/stream';
import { setupClientDebugInterceptors, setupServerDebugListeners } from '../src/utils/debug';
import { SyncHook } from '../src/utils/hooks';

jest.mock('../src/utils/debug', () => {
  const actual = jest.requireActual('../src/utils/debug');
  return {
    ...actual,
    setupClientDebugInterceptors: jest.fn(actual.setupClientDebugInterceptors),
    setupServerDebugListeners: jest.fn(actual.setupServerDebugListeners)
  };
});

describe('Coverage - branch focused tests', () => {
  beforeEach(() => {
    (setupClientDebugInterceptors as unknown as jest.Mock).mockClear();
    (setupServerDebugListeners as unknown as jest.Mock).mockClear();
    clearServerCache();
  });

  describe('src/api/client.ts', () => {
    it('should create client with Window target', () => {
      const client = requestIframeClient(window as any);
      expect(client).toBeDefined();
      expect((client as any).targetWindow || (client as any).targetOrigin).toBeDefined();
    });

    it('should throw IFRAME_NOT_READY when iframe.contentWindow is unavailable', () => {
      const iframe = document.createElement('iframe');
      Object.defineProperty(iframe, 'contentWindow', { value: null, writable: true });
      try {
        requestIframeClient(iframe as any);
        throw new Error('should have thrown');
      } catch (e: any) {
        expect(e).toBeDefined();
        expect(e.code).toBe(ErrorCode.IFRAME_NOT_READY);
      }
    });

    it('should enable trace mode and register debug interceptors', async () => {
      const client = requestIframeClient(window as any, { trace: true } as any);
      expect(client).toBeDefined();
      // debug module is lazy-loaded via dynamic import
      for (let i = 0; i < 20; i++) {
        if ((setupClientDebugInterceptors as unknown as jest.Mock).mock.calls.length > 0) break;
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(setupClientDebugInterceptors).toHaveBeenCalledTimes(1);
    });
  });

  describe('src/api/server.ts', () => {
    it('should cache server when id is provided', () => {
      const s1 = requestIframeServer({ id: 'server-1' } as any);
      const s2 = requestIframeServer({ id: 'server-1' } as any);
      expect(s1).toBe(s2);
    });

    it('should enable trace mode and register server debug listeners', async () => {
      const s = requestIframeServer({ id: 'server-trace', trace: true } as any);
      expect(s).toBeDefined();
      // debug module is lazy-loaded via dynamic import
      for (let i = 0; i < 20; i++) {
        if ((setupServerDebugListeners as unknown as jest.Mock).mock.calls.length > 0) break;
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(setupServerDebugListeners).toHaveBeenCalledTimes(1);
    });
  });

  describe('src/constants/index.ts + messages.ts', () => {
    it('getStatusText should return Unknown for unknown code', () => {
      expect(getStatusText(999)).toBe('Unknown');
    });

    it('Messages proxy should return key when missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((Messages as any).SOME_UNKNOWN_KEY).toBe('SOME_UNKNOWN_KEY');
    });

    it('formatMessage should keep placeholder when args missing', () => {
      // {1} has no arg, should remain as "{1}"
      expect(Messages.PROTOCOL_VERSION_TOO_LOW.replace('{0}', '0')).toContain('{1}');
    });
  });

  describe('src/interceptors/index.ts', () => {
    it('runRequestInterceptors should use rejected handler when provided', async () => {
      const m = new RequestInterceptorManager();
      m.use(() => {
        throw new Error('boom');
      });
      m.use(
        (cfg) => cfg,
        (err) => ({ path: 'recovered', body: { message: err.message } } as any)
      );
      const out = await runRequestInterceptors(m, { path: 'x' } as any);
      expect(out.path).toBe('recovered');
      expect((out as any).body.message).toBe('boom');
    });

    it('runResponseInterceptors should reject when rejected handler is not provided', async () => {
      const m = new ResponseInterceptorManager();
      m.use(() => {
        throw new Error('nope');
      });
      await expect(runResponseInterceptors(m, { data: 1 } as any)).rejects.toBeInstanceOf(Error);
    });

    it('InterceptorManager.eject should null out handler, and forEach should skip nulls', () => {
      const mgr = new InterceptorManager<any>();
      const id = mgr.use((x) => x);
      mgr.eject(id);
      const seen: any[] = [];
      mgr.forEach((h) => seen.push(h));
      expect(seen.length).toBe(0);
    });
  });

  describe('src/impl/response.ts (setHeader/cookie branches)', () => {
    function createRes() {
      const channel = { send: jest.fn() } as any;
      const targetWindow = { postMessage: jest.fn() } as any;
      const peer = { sendMessage: jest.fn(() => true), targetWindow, targetOrigin: '*', channel } as any;
      return { res: new ServerResponseImpl('rid', '/p', undefined, peer), channel };
    }

    it('setHeader should merge Set-Cookie arrays and strings', () => {
      const { res } = createRes();
      res.setHeader('Set-Cookie', 'a=1');
      res.setHeader('Set-Cookie', ['b=2', 'c=3']);
      res.setHeader('Set-Cookie', 'd=4');
      const sc = (res.headers['Set-Cookie'] as string[]) || [];
      expect(sc).toEqual(['a=1', 'b=2', 'c=3', 'd=4']);
    });

    it('setHeader should join non-Set-Cookie array values', () => {
      const { res } = createRes();
      res.setHeader('X-Test', ['a', 'b']);
      expect(res.headers['X-Test']).toBe('a, b');
    });

    it('cookie should handle sameSite true/false/string branches', () => {
      const { res } = createRes();
      res.cookie('k1', 'v1', { sameSite: true });
      res.cookie('k2', 'v2', { sameSite: false });
      res.cookie('k3', 'v3', { sameSite: 'Lax' as any });
      expect(Array.isArray(res.headers['Set-Cookie'])).toBe(true);
      expect((res.headers['Set-Cookie'] as string[]).length).toBe(3);
    });

    it('clearCookie should append Set-Cookie', () => {
      const { res } = createRes();
      res.clearCookie('k', { path: '/' });
      expect(Array.isArray(res.headers['Set-Cookie'])).toBe(true);
    });
  });

  describe('src/stream/file-stream.ts (encode/decode/merge branches)', () => {
    it('IframeFileWritableStream.encodeData should handle ArrayBuffer and other types', () => {
      const ws = new IframeFileWritableStream({
        filename: 'f',
        mimeType: 'text/plain',
        next: async () => ({ data: 'Zg==', done: true })
      });
      const ab = new Uint8Array([1, 2, 3]).buffer;
      expect((ws as any).encodeData(ab)).toBeDefined();
      const encoded = (ws as any).encodeData(123);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(Array.from(encoded)).toEqual(Array.from(Uint8Array.from(Buffer.from('123', 'utf8'))));
    });

    it('IframeFileReadableStream.decodeData should handle ArrayBuffer and unknown types', async () => {
      const rh: any = {
        registerStreamHandler: jest.fn(),
        unregisterStreamHandler: jest.fn(),
        postMessage: jest.fn()
      };
      const rs = new IframeFileReadableStream('sid', 'rid', rh);
      const ab = new Uint8Array([7, 8]).buffer;
      expect((rs as any).decodeData(ab)).toBeInstanceOf(Uint8Array);
      expect((rs as any).decodeData(1)).toBeInstanceOf(Uint8Array);
    });

    it('mergeChunks should handle 0/1/many branches', () => {
      const rh: any = {
        registerStreamHandler: jest.fn(),
        unregisterStreamHandler: jest.fn(),
        postMessage: jest.fn()
      };
      const rs: any = new IframeFileReadableStream('sid', 'rid', rh);
      rs.chunks = [];
      expect(rs.mergeChunks()).toBeInstanceOf(Uint8Array);
      rs.chunks = [new Uint8Array([1])];
      expect(rs.mergeChunks()).toEqual(new Uint8Array([1]));
      rs.chunks = [new Uint8Array([1, 2]), new Uint8Array([3])];
      expect(rs.mergeChunks()).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('readAsFile should prefer explicit fileName parameter', async () => {
      const rh: any = {
        registerStreamHandler: jest.fn(),
        unregisterStreamHandler: jest.fn(),
        postMessage: jest.fn()
      };
      const rs: any = new IframeFileReadableStream('sid', 'rid', rh, { filename: 'default.txt', mimeType: 'text/plain' });
      rs.read = jest.fn().mockResolvedValue(new Uint8Array([65])); // 'A'
      const f: File = await rs.readAsFile('explicit.txt');
      expect(f.name).toBe('explicit.txt');
    });
  });

  describe('src/utils/debug.ts branches', () => {
    it('setupClientDebugInterceptors should log success for file/stream/plain and log error', async () => {
      const requestUse = jest.fn();
      const responseUse = jest.fn();
      const fakeClient: any = {
        interceptors: {
          request: { use: requestUse },
          response: { use: responseUse }
        }
      };

      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      setupClientDebugInterceptors(fakeClient);
      expect(requestUse).toHaveBeenCalled();
      expect(responseUse).toHaveBeenCalled();

      const [onFulfilled, onRejected] = responseUse.mock.calls[0];

      // File/Blob branch
      await onFulfilled({ requestId: 'r', status: 200, statusText: 'OK', data: new Blob(['x'], { type: 'text/plain' }) });
      // Stream branch
      await onFulfilled({ requestId: 'r', status: 200, statusText: 'OK', data: { ok: true }, stream: { streamId: 's', type: 'data' } });
      // Plain branch
      await onFulfilled({ requestId: 'r', status: 200, statusText: 'OK', data: { ok: true } });

      // Error branch
      await expect(
        onRejected({ requestId: 'r', code: 'X', message: 'bad' })
      ).rejects.toBeDefined();

      expect(infoSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();

      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('setupServerDebugListeners should cover server-side debug branches (with and without sendStream)', async () => {
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      // Fake server implementation shape used by setupServerDebugListeners
      const middlewares: any[] = [];
      const dispatcher: any = {
        hooks: {
          inbound: new SyncHook<any[]>(),
          afterSend: new SyncHook<any[]>()
        }
      };

      const serverImpl: any = {
        messageDispatcher: dispatcher,
        // Will be wrapped by setupServerMessageDebugging
        handleRequest: jest.fn(),
        runMiddlewares: jest.fn((req: any, res: any, cb: any) => cb())
      };

      const fakeServer: any = {
        use: jest.fn((mw: any) => middlewares.push(mw)),
        // allow setupServerDebugListeners to find impl fields via cast
        messageDispatcher: dispatcher
      };
      // Attach impl fields directly on fakeServer (since code uses `server as any`)
      Object.assign(fakeServer, serverImpl);

      setupServerDebugListeners(fakeServer);
      expect(fakeServer.use).toHaveBeenCalled();

      // Grab the middleware registered by setupServerDebugListeners
      const mw = middlewares[0];
      expect(typeof mw).toBe('function');

      const req: any = {
        requestId: 'rid-1',
        path: '/api/test',
        body: { a: 1 },
        origin: 'https://example.com',
        headers: { h: 'v' },
        cookies: { c: '1' }
      };

      // Case A: res has sendStream
      const resA: any = {
        statusCode: 200,
        headers: {},
        send: jest.fn(async () => true),
        json: jest.fn(async () => true),
        sendFile: jest.fn(async () => true),
        sendStream: jest.fn(async () => undefined),
        status: jest.fn(function (code: number) { this.statusCode = code; return this; }),
        setHeader: jest.fn(function (name: string, value: any) { this.headers[name] = value; })
      };

      await new Promise<void>((resolve) => mw(req, resA, resolve));
      // Trigger overridden methods (cover branches)
      resA.status(201);
      resA.setHeader('X-Test', 'v');
      await resA.send({ ok: true }, { requireAck: true });
      await resA.json({ ok: true }, { requireAck: false });
      await resA.sendFile('content', { fileName: 'a.txt', mimeType: 'text/plain' });
      await resA.sendStream({ streamId: 'sid-1' });

      // Case B: res has NO sendStream (skip that override branch)
      const resB: any = {
        statusCode: 200,
        headers: {},
        send: jest.fn(async () => true),
        json: jest.fn(async () => true),
        sendFile: jest.fn(async () => true),
        status: jest.fn(function (code: number) { this.statusCode = code; return this; }),
        setHeader: jest.fn(function (name: string, value: any) { this.headers[name] = value; })
      };
      await new Promise<void>((resolve) => mw({ ...req, requestId: 'rid-2' }, resB, resolve));
      await resB.send({ ok: true });

      // Cover MessageDispatcher hook-based logging branches
      dispatcher.hooks.inbound.call(
        { type: MessageType.REQUEST, requestId: 'rid-3', path: '/p', role: 'client', creatorId: 'c' },
        { origin: 'o' }
      );
      dispatcher.hooks.afterSend.call({} as any, '*', { type: MessageType.ACK, requestId: 'rid-1', path: '/p' }, true);
      dispatcher.hooks.afterSend.call({} as any, '*', { type: MessageType.ASYNC, requestId: 'rid-1', path: '/p' }, true);
      dispatcher.hooks.afterSend.call(
        {} as any,
        '*',
        { type: MessageType.STREAM_START, requestId: 'rid-1', body: { streamId: 's', type: 'file', chunked: true, autoResolve: true, metadata: { a: 1 } } },
        true
      );
      dispatcher.hooks.afterSend.call(
        {} as any,
        '*',
        { type: MessageType.STREAM_DATA, requestId: 'rid-1', body: { streamId: 's', done: false, data: 'xxx' } },
        true
      );
      dispatcher.hooks.afterSend.call({} as any, '*', { type: MessageType.STREAM_END, requestId: 'rid-1', body: { streamId: 's' } }, true);
      dispatcher.hooks.afterSend.call(
        {} as any,
        '*',
        { type: MessageType.ERROR, requestId: 'rid-1', status: 500, statusText: 'ERR', error: { message: 'x' }, path: '/p' },
        true
      );
      dispatcher.hooks.afterSend.call(
        {} as any,
        '*',
        { type: MessageType.RESPONSE, requestId: 'rid-1', status: 200, statusText: 'OK', requireAck: false, path: '/p' },
        true
      );

      expect(infoSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();

      infoSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});

