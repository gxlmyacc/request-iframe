import { IframeReadableStream } from '../stream/readable-stream';
import { MessageType, StreamInternalMessageType, StreamState as StreamStateConstant } from '../constants';

function createMockHandler() {
  const handlers = new Map<string, (d: any) => void>();
  const posted: any[] = [];
  const api = {
    posted,
    registerStreamHandler: (streamId: string, handler: (data: any) => void) => {
      handlers.set(streamId, handler);
    },
    unregisterStreamHandler: (streamId: string) => {
      handlers.delete(streamId);
    },
    postMessage: (message: any) => {
      posted.push(message);
    },
    emit: (streamId: string, data: any) => {
      const h = handlers.get(streamId);
      if (h) h(data);
    },
    hasHandler: (streamId: string) => handlers.has(streamId)
  };
  return api;
}

async function flushMicrotasks(times: number = 2): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('stream/readable-stream (IframeReadableStream)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('should post initial pull on construct', async () => {
    const mh = createMockHandler();
    const rs = new IframeReadableStream('sid', 'rid', mh as any);
    await flushMicrotasks();
    expect(mh.posted.some((m) => m?.type === MessageType.STREAM_PULL)).toBe(true);
    rs.cancel();
  });

  it('mergeChunks should handle 0/1/many branches via read()', async () => {
    const mh1 = createMockHandler();
    const rs1 = new IframeReadableStream('sid1', 'rid1', mh1 as any);
    mh1.emit('sid1', { streamId: 'sid1', type: StreamInternalMessageType.END });
    await expect(rs1.read()).resolves.toBeUndefined();

    const mh2 = createMockHandler();
    const rs2 = new IframeReadableStream('sid2', 'rid2', mh2 as any);
    mh2.emit('sid2', { streamId: 'sid2', type: StreamInternalMessageType.DATA, data: 'a', done: true });
    await expect(rs2.read()).resolves.toBe('a');

    const mh3 = createMockHandler();
    const rs3 = new IframeReadableStream('sid3', 'rid3', mh3 as any);
    mh3.emit('sid3', { streamId: 'sid3', type: StreamInternalMessageType.DATA, data: 'a' });
    mh3.emit('sid3', { streamId: 'sid3', type: StreamInternalMessageType.DATA, data: 'b', done: true });
    await expect(rs3.read()).resolves.toEqual(['a', 'b']);
  });

  it('should not ACK data chunks by default (ack is not required for pull/backpressure)', async () => {
    const mh = createMockHandler();
    const rs = new IframeReadableStream('sid', 'rid', mh as any);
    mh.posted.length = 0;

    mh.emit('sid', { streamId: 'sid', type: StreamInternalMessageType.DATA, data: 'x', seq: 0, done: true });
    await flushMicrotasks();

    expect(mh.posted.some((m) => m?.type === MessageType.STREAM_ACK)).toBe(false);
    await expect(rs.read()).resolves.toBe('x');
  });

  it('should ignore pull/ack inbound messages (writer-side control messages)', async () => {
    const mh = createMockHandler();
    const rs = new IframeReadableStream('sid', 'rid', mh as any);
    mh.emit('sid', { streamId: 'sid', type: StreamInternalMessageType.PULL, credit: 1 });
    mh.emit('sid', { streamId: 'sid', type: StreamInternalMessageType.END });
    await expect(rs.readAll()).resolves.toEqual([]);
  });

  it('requestMore should ignore non-positive credit and non-streaming states (branch coverage)', async () => {
    const mh = createMockHandler();
    const rs: any = new IframeReadableStream('sid', 'rid', mh as any);
    mh.posted.length = 0;

    rs.requestMore(0);
    rs.requestMore(-1);
    await flushMicrotasks();
    expect(mh.posted.length).toBe(0);

    rs._state = StreamStateConstant.ENDED;
    rs.requestMore(1);
    await flushMicrotasks();
    expect(mh.posted.length).toBe(0);
  });

  it('schedulePullIfNeeded should schedule at most once per tick (branch coverage)', async () => {
    const mh = createMockHandler();
    const rs: any = new IframeReadableStream('sid', 'rid', mh as any);
    mh.posted.length = 0;

    rs.schedulePullIfNeeded();
    rs.schedulePullIfNeeded();
    await flushMicrotasks();

    const pulls = mh.posted.filter((m) => m?.type === MessageType.STREAM_PULL);
    expect(pulls.length).toBe(1);
  });

  it('cancel should notify remote (stream_cancel) and unregister handler', async () => {
    const mh = createMockHandler();
    const rs = new IframeReadableStream('sid', 'rid', mh as any);
    mh.posted.length = 0;
    expect(mh.hasHandler('sid')).toBe(true);

    rs.cancel('bye');
    await flushMicrotasks();

    expect(mh.posted.some((m) => m?.type === MessageType.STREAM_CANCEL)).toBe(true);
    expect(mh.hasHandler('sid')).toBe(false);
  });

  it('cancel should ignore remote send failures (branch coverage)', async () => {
    const mh = createMockHandler();
    mh.postMessage = () => {
      throw new Error('send failed');
    };
    const rs = new IframeReadableStream('sid', 'rid', mh as any);
    expect(() => rs.cancel('bye')).not.toThrow();
  });

  it('should fail with idle timeout when no heartbeat is available', async () => {
    jest.useFakeTimers();
    const mh = createMockHandler();
    const rs = new IframeReadableStream('sid', 'rid', mh as any, { idleTimeout: 10 });
    const p = rs.readAll();

    jest.advanceTimersByTime(10);
    await flushMicrotasks(4);

    await expect(p).rejects.toThrow(/Stream idle timeout/i);
  });

  it('idle timeout should heartbeat-check and continue when heartbeat returns true', async () => {
    jest.useFakeTimers();
    const mh = createMockHandler();
    const heartbeat = jest.fn(async () => true);
    const rs = new IframeReadableStream('sid', 'rid', mh as any, { idleTimeout: 10, heartbeat });

    const p = rs.readAll();
    jest.advanceTimersByTime(10);
    await flushMicrotasks(4);
    expect(heartbeat).toHaveBeenCalled();

    mh.emit('sid', { streamId: 'sid', type: StreamInternalMessageType.END });
    await flushMicrotasks(2);
    await expect(p).resolves.toEqual([]);
  });

  it('async iterator should compact chunks when consume is true and index > 128', async () => {
    const mh = createMockHandler();
    const rs: any = new IframeReadableStream('sid', 'rid', mh as any, { consume: true });
    rs.chunks = Array.from({ length: 129 }, (_, i) => i);
    rs._state = StreamStateConstant.STREAMING;

    const it = rs[Symbol.asyncIterator]();
    for (let i = 0; i < 129; i++) {
      const r = await it.next();
      expect(r.done).toBe(false);
    }
    expect(rs.chunks.length).toBe(0);
  });

  it('async iterator should not compact when consume is false', async () => {
    const mh = createMockHandler();
    const rs: any = new IframeReadableStream('sid', 'rid', mh as any, { consume: false });
    rs.chunks = Array.from({ length: 129 }, (_, i) => i);
    rs._state = StreamStateConstant.STREAMING;

    const it = rs[Symbol.asyncIterator]();
    for (let i = 0; i < 129; i++) {
      const r = await it.next();
      expect(r.done).toBe(false);
    }
    expect(rs.chunks.length).toBe(129);
  });
});

