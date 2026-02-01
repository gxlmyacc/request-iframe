import { setupClientDebugInterceptors, setupServerDebugListeners } from '../src/utils/debug';
import { MessageType } from '../src/constants';
import { SyncHook } from '../src/utils/hooks';

describe('coverage: utils/debug', () => {
  it('setupClientDebugInterceptors: interceptors + hook-based inbound/outbound logging', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => void 0);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => void 0);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => void 0);

    let reqInterceptor: any;
    let resFulfilled: any;
    let resRejected: any;

    const inbox = { hooks: { inbound: new SyncHook<any[]>() } };
    const outbox = { hooks: { afterSendMessage: new SyncHook<any[]>() } };

    const client: any = {
      interceptors: {
        request: { use: (fn: any) => (reqInterceptor = fn) },
        response: { use: (ok: any, bad: any) => ((resFulfilled = ok), (resRejected = bad)) }
      },
      inbox,
      outbox
    };

    setupClientDebugInterceptors(client);

    /** request log + truncation */
    reqInterceptor({
      path: '/x',
      body: { big: 'x'.repeat(600) }
    });
    expect(infoSpy).toHaveBeenCalled();

    /** response branches: file/blob, stream, normal */
    await resFulfilled({ requestId: 'r', status: 200, statusText: 'OK', headers: {}, data: new Blob(['x']) });
    await resFulfilled({ requestId: 'r', status: 200, statusText: 'OK', headers: {}, data: { a: 1 }, stream: { streamId: 's', type: 'data' } });
    await resFulfilled({ requestId: 'r', status: 200, statusText: 'OK', headers: {}, data: { a: 1 } });
    expect(infoSpy).toHaveBeenCalled();

    /** error branch */
    await expect(resRejected({ requestId: 'r', code: 'X', message: 'm' })).rejects.toBeDefined();
    expect(errorSpy).toHaveBeenCalled();

    /** inbound hook branches (ACK/ASYNC/STREAM_START/STREAM_DATA/STREAM_END/RESPONSE/ERROR) */
    (inbox.hooks.inbound as any).call({ type: MessageType.ACK, requestId: 'r1', path: '/p' }, {});
    (inbox.hooks.inbound as any).call({ type: MessageType.ASYNC, requestId: 'r1', path: '/p' }, {});
    (inbox.hooks.inbound as any).call({ type: MessageType.STREAM_START, requestId: 'r1', body: { streamId: 's', type: 'file', chunked: true, autoResolve: true } }, {});
    (inbox.hooks.inbound as any).call({ type: MessageType.STREAM_DATA, requestId: 'r1', body: { streamId: 's', data: 'x', done: false } }, {});
    (inbox.hooks.inbound as any).call({ type: MessageType.STREAM_END, requestId: 'r1', body: { streamId: 's' } }, {});
    (inbox.hooks.inbound as any).call({ type: MessageType.RESPONSE, requestId: 'r1', status: 200, statusText: 'OK', requireAck: false }, {});
    (inbox.hooks.inbound as any).call({ type: MessageType.ERROR, requestId: 'r1', status: 500, statusText: 'ERR', error: { message: 'e' } }, {});
    expect(infoSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    /** outbound hook branches: REQUEST / PING / ACK */
    (outbox.hooks.afterSendMessage as any).call(MessageType.REQUEST, 'r2', { path: '/p', body: {}, headers: {} }, true);
    (outbox.hooks.afterSendMessage as any).call(MessageType.PING, 'r2', {}, true);
    (outbox.hooks.afterSendMessage as any).call(MessageType.ACK, 'r2', {}, true);
    expect(infoSpy).toHaveBeenCalled();

    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('setupClientDebugInterceptors: fallback to dispatcher hooks when inbox/outbox missing', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => void 0);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => void 0);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => void 0);

    const dispatcher: any = { hooks: { inbound: new SyncHook<any[]>(), afterSend: new SyncHook<any[]>() } };
    const hub: any = { messageDispatcher: dispatcher };

    const client: any = {
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      },
      hub
    };

    setupClientDebugInterceptors(client);

    /** trigger inbound */
    dispatcher.hooks.inbound.call({ type: MessageType.ACK, requestId: 'r1', path: '/p' }, {});

    /** trigger outbound */
    dispatcher.hooks.afterSend.call(window, '*', { type: MessageType.REQUEST, requestId: 'r2', path: '/p', body: {}, headers: {} }, true);

    expect(infoSpy).toHaveBeenCalled();

    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('setupServerDebugListeners: middleware + dispatcher hooks branches', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => void 0);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => void 0);

    const mws: any[] = [];
    const dispatcher: any = { hooks: { inbound: new SyncHook<any[]>(), afterSend: new SyncHook<any[]>() } };

    const server: any = {
      use: (mw: any) => mws.push(mw),
      messageDispatcher: dispatcher,
      on: jest.fn(),
      off: jest.fn(),
      map: jest.fn()
    };

    setupServerDebugListeners(server);
    expect(mws.length).toBeGreaterThan(0);

    const req: any = { requestId: 'r1', path: '/p', body: { a: 1 }, origin: 'o', headers: {}, cookies: {} };
    const res: any = {
      statusCode: 200,
      headers: {},
      send: jest.fn(async () => true),
      json: jest.fn(async () => true),
      sendFile: jest.fn(async () => true),
      sendStream: jest.fn(async () => void 0),
      status: jest.fn(function () { return this; }),
      setHeader: jest.fn()
    };
    const next = jest.fn();

    /** run middleware and call overridden methods */
    mws[0](req, res, next);
    expect(next).toHaveBeenCalled();
    res.status(201);
    res.setHeader('a', ['1', '2']);
    await res.send({ ok: true }, { requireAck: true });
    await res.json({ ok: true }, { requireAck: true });
    await res.sendFile('x', { fileName: 'a', mimeType: 'text/plain' });
    await res.sendStream({ streamId: 's' });
    expect(infoSpy).toHaveBeenCalled();

    /** dispatcher hook branches */
    dispatcher.hooks.inbound.call({ type: MessageType.REQUEST, requestId: 'r1', path: '/p', role: 'client', creatorId: 'c' }, { origin: 'o' });
    dispatcher.hooks.afterSend.call(window, '*', { type: MessageType.ACK, requestId: 'r1', path: '/p' }, true);
    dispatcher.hooks.afterSend.call(window, '*', { type: MessageType.ASYNC, requestId: 'r1', path: '/p' }, true);
    dispatcher.hooks.afterSend.call(window, '*', { type: MessageType.STREAM_START, requestId: 'r1', body: { streamId: 's', type: 'file', chunked: true, autoResolve: true } }, true);
    dispatcher.hooks.afterSend.call(window, '*', { type: MessageType.STREAM_DATA, requestId: 'r1', body: { streamId: 's', data: 'x', done: false } }, true);
    dispatcher.hooks.afterSend.call(window, '*', { type: MessageType.STREAM_END, requestId: 'r1', body: { streamId: 's' } }, true);
    dispatcher.hooks.afterSend.call(window, '*', { type: MessageType.ERROR, requestId: 'r1', status: 500, statusText: 'ERR', error: { message: 'e' }, path: '/p' }, true);
    dispatcher.hooks.afterSend.call(window, '*', { type: MessageType.RESPONSE, requestId: 'r1', status: 200, statusText: 'OK', requireAck: false, path: '/p' }, true);
    expect(infoSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

