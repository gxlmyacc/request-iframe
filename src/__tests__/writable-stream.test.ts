import type { MessageChannel } from '../message';
import { IframeWritableStream } from '../stream/writable-stream';
import { MessageType, StreamInternalMessageType, StreamMode as StreamModeConstant, StreamState as StreamStateConstant, Messages } from '../constants';

function createBoundContext(options?: {
  /** simulate client-side stream (clientId set, serverId undefined) */
  clientSide?: boolean;
  /** channel send() return value */
  sendOk?: boolean;
  /** heartbeat result */
  heartbeat?: () => Promise<boolean>;
}) {
  const posted: any[] = [];
  const sendOk = options?.sendOk ?? true;

  const mockTargetWindow: Window = { postMessage: jest.fn() } as any;

  const channel: MessageChannel = {
    send: (target: any, message: any, origin: string) => {
      posted.push({ target, message, origin });
      return sendOk;
    }
  } as any;

  const controlHandlers = new Map<string, (d: any) => void>();

  const ctx: any = {
    requestId: 'rid',
    targetWindow: mockTargetWindow,
    targetOrigin: 'https://example.com',
    secretKey: 'sk',
    channel,
    targetId: 'client-1',
    clientId: options?.clientSide ? 'client-1' : undefined,
    serverId: options?.clientSide ? undefined : 'server-1',
    registerStreamHandler: (streamId: string, handler: any) => controlHandlers.set(streamId, handler),
    unregisterStreamHandler: (streamId: string) => controlHandlers.delete(streamId),
    heartbeat: options?.heartbeat
  };

  return { ctx, posted, controlHandlers };
}

async function flushMicrotasks(times: number = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('stream/writable-stream (IframeWritableStream) - branch focused', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('sendMessage should throw STREAM_NOT_BOUND when not bound', () => {
    const ws: any = new IframeWritableStream();
    expect(() => ws.sendMessage(MessageType.STREAM_START)).toThrow(Messages.STREAM_NOT_BOUND);
  });

  it('start should throw STREAM_ALREADY_STARTED when started twice', async () => {
    const ws = new IframeWritableStream();
    const { ctx, controlHandlers } = createBoundContext();
    ws._bind(ctx);
    const p = ws.start();
    controlHandlers.get(ws.streamId)?.({ streamId: ws.streamId, type: StreamInternalMessageType.PULL, credit: 1 });
    await p;
    await expect(ws.start()).rejects.toThrow(Messages.STREAM_ALREADY_STARTED);
  });

  it('should send STREAM_START with correct role/creatorId for server-side and client-side streams', async () => {
    const wsServer = new IframeWritableStream({ mode: StreamModeConstant.PULL });
    const a = createBoundContext({ clientSide: false });
    wsServer._bind(a.ctx);
    const p1 = wsServer.start();
    a.controlHandlers.get(wsServer.streamId)?.({ streamId: wsServer.streamId, type: StreamInternalMessageType.PULL, credit: 1 });
    await p1;
    const startMsg1 = a.posted.find((x) => x.message?.type === MessageType.STREAM_START)?.message;
    expect(startMsg1?.role).toBe('server');
    expect(startMsg1?.creatorId).toBe('server-1');

    const wsClient = new IframeWritableStream({ mode: StreamModeConstant.PULL });
    const b = createBoundContext({ clientSide: true });
    wsClient._bind(b.ctx);
    const p2 = wsClient.start();
    b.controlHandlers.get(wsClient.streamId)?.({ streamId: wsClient.streamId, type: StreamInternalMessageType.PULL, credit: 1 });
    await p2;
    const startMsg2 = b.posted.find((x) => x.message?.type === MessageType.STREAM_START)?.message;
    expect(startMsg2?.role).toBe('client');
    expect(startMsg2?.creatorId).toBe('client-1');
  });

  it('handleControlMessage should cover ACK/default branches and CANCEL branch', async () => {
    const ws = new IframeWritableStream();
    const { ctx, controlHandlers } = createBoundContext();
    ws._bind(ctx);
    const p = ws.start();

    // unknown type -> default branch
    controlHandlers.get(ws.streamId)?.({ streamId: ws.streamId, type: 'unknown' });
    // ACK -> no-op branch
    controlHandlers.get(ws.streamId)?.({ streamId: ws.streamId, type: StreamInternalMessageType.ACK, seq: 0 });
    // CANCEL -> triggers cancel branch
    controlHandlers.get(ws.streamId)?.({ streamId: ws.streamId, type: StreamInternalMessageType.CANCEL, reason: 'bye' });

    await p;
    expect(ws.state).toBe(StreamStateConstant.CANCELLED);
  });

  it('pull mode with no producer should end when pulled (pumpFromGenerator else branch)', async () => {
    const ws = new IframeWritableStream({ mode: StreamModeConstant.PULL });
    const { ctx, controlHandlers } = createBoundContext();
    ws._bind(ctx);
    const p = ws.start();
    controlHandlers.get(ws.streamId)?.({ streamId: ws.streamId, type: StreamInternalMessageType.PULL, credit: 1 });
    await p;
    expect(ws.state).toBe(StreamStateConstant.ENDED);
  });

  it('push mode: write() should throw when called before start()', () => {
    const ws = new IframeWritableStream({ mode: StreamModeConstant.PUSH });
    const { ctx } = createBoundContext();
    ws._bind(ctx);
    expect(() => ws.write('x')).toThrow(Messages.STREAM_NOT_BOUND);
  });

  it('push mode: write() should throw STREAM_ENDED after end', async () => {
    const ws = new IframeWritableStream({ mode: StreamModeConstant.PUSH });
    const { ctx, controlHandlers } = createBoundContext();
    ws._bind(ctx);
    const p = ws.start();
    // grant credit so buffered chunks can actually be sent
    controlHandlers.get(ws.streamId)?.({ streamId: ws.streamId, type: StreamInternalMessageType.PULL, credit: 10 });
    ws.end();
    await p;
    expect(ws.state).toBe(StreamStateConstant.ENDED);
    expect(() => ws.write('x')).toThrow(Messages.STREAM_ENDED);
  });

  it('write() should throw STREAM_WRITE_ONLY_IN_PUSH_MODE when mode is pull', () => {
    const ws = new IframeWritableStream({ mode: StreamModeConstant.PULL });
    expect(() => ws.write('x')).toThrow(Messages.STREAM_WRITE_ONLY_IN_PUSH_MODE);
  });

  it('cancel should no-op when already ended (branch)', async () => {
    const ws = new IframeWritableStream({ mode: StreamModeConstant.PULL });
    const { ctx, controlHandlers } = createBoundContext();
    ws._bind(ctx);
    const p = ws.start();
    controlHandlers.get(ws.streamId)?.({ streamId: ws.streamId, type: StreamInternalMessageType.PULL, credit: 1 });
    await p;
    expect(ws.state).toBe(StreamStateConstant.ENDED);
    ws.cancel('x');
    expect(ws.state).toBe(StreamStateConstant.ENDED);
  });

  it('send failure should cancel and propagate (start catch CANCELLED branch)', async () => {
    const ws = new IframeWritableStream({ mode: StreamModeConstant.PULL });
    const { ctx } = createBoundContext({ sendOk: false });
    ws._bind(ctx);
    await expect(ws.start()).rejects.toBeInstanceOf(Error);
    expect(ws.state).toBe(StreamStateConstant.CANCELLED);
  });

  it('idle timer should postpone when recent remote activity < timeout', async () => {
    jest.useFakeTimers();
    const ws: any = new IframeWritableStream({ mode: StreamModeConstant.PULL, streamTimeout: 10 });
    const { ctx, controlHandlers } = createBoundContext({
      heartbeat: async () => {
        throw new Error('should not heartbeat in postpone branch');
      }
    });
    ws._bind(ctx);
    const p = ws.start();

    // start streaming but do not end it
    controlHandlers.get(ws.streamId)?.({ streamId: ws.streamId, type: StreamInternalMessageType.PULL, credit: 1 });
    await flushMicrotasks();

    // Make activity "recent": set at t=5, timer fires at t=10 => diff=5 < 10
    jest.advanceTimersByTime(5);
    ws.lastRemoteActivityAt = Date.now();
    jest.advanceTimersByTime(5);
    await flushMicrotasks(6);

    ws.cancel('cleanup');
    await p;
  });

  it('idle timer should heartbeat-check and error when heartbeat returns false', async () => {
    jest.useFakeTimers();
    const ws = new IframeWritableStream({ mode: StreamModeConstant.PULL, streamTimeout: 10 });
    const { ctx, posted } = createBoundContext({ heartbeat: async () => false });
    ws._bind(ctx);
    const p = ws.start();

    // Use async timer advancement to ensure async callback completes
    // (callback awaits performHeartbeat()).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (jest as any).advanceTimersByTimeAsync(10);
    await flushMicrotasks(6);

    // should send stream_error
    expect(posted.some((x) => x.message?.type === MessageType.STREAM_ERROR)).toBe(true);
    ws.cancel('cleanup');
    await p;
  });

  it('expire timer should send stream_error when expires (expireTimeout branch)', async () => {
    jest.useFakeTimers();
    const ws = new IframeWritableStream({ mode: StreamModeConstant.PULL, expireTimeout: 10 });
    const { ctx, posted } = createBoundContext();
    ws._bind(ctx);
    const p = ws.start();

    jest.advanceTimersByTime(10);
    await flushMicrotasks(6);
    expect(posted.some((x) => x.message?.type === MessageType.STREAM_ERROR)).toBe(true);
    ws.cancel('cleanup');
    await p;
  });

  it('cancel should ignore send failures (catch branch)', async () => {
    const ws = new IframeWritableStream({ mode: StreamModeConstant.PULL });
    const { ctx, controlHandlers } = createBoundContext({ sendOk: true });
    ws._bind(ctx);
    const p = ws.start();
    controlHandlers.get(ws.streamId)?.({ streamId: ws.streamId, type: StreamInternalMessageType.PULL, credit: 1 });
    await flushMicrotasks();
    // make cancel send fail only (after stream_start was sent successfully)
    ctx.channel.send = () => false;
    expect(() => ws.cancel('bye')).not.toThrow();
    await p;
  });
});

