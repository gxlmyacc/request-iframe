import { ServerResponseImpl } from '../src/impl/response';
import { HttpHeader, MessageRole } from '../src/constants';

describe('coverage: impl/response', () => {
  it('should send normal data with requireAck=false', async () => {
    const peer: any = {
      defaultTargetId: 'c1',
      sendMessage: jest.fn(() => true),
      send: async (params: any) => params.onOther(params.data)
    };

    const res = new ServerResponseImpl('r1', '/p', 's1', peer);
    const ok = await res.send({ hello: 'world' }, { requireAck: false });
    expect(ok).toBe(true);
    expect(peer.sendMessage).toHaveBeenCalled();
    expect(res._sent).toBe(true);
  });

  it('should send normal data with requireAck=true and resolve when _triggerAck matches', async () => {
    const peer: any = {
      defaultTargetId: 'c1',
      sendMessage: jest.fn(() => true),
      send: async (params: any) => params.onOther(params.data)
    };

    const res = new ServerResponseImpl('r2', '/p', 's1', peer);
    const p = res.send({ hello: 'world' }, { requireAck: true });

    const call = peer.sendMessage.mock.calls.find((c: any[]) => c[0] === 'response');
    expect(call).toBeDefined();
    const payload = call[2];
    expect(payload.requireAck).toBe(true);
    expect(payload.ack).toBeDefined();

    res._triggerAck(true, payload.ack);
    await expect(p).resolves.toBe(true);

    /** already sent -> false */
    await expect(res.send({ again: true })).resolves.toBe(false);
  });

  it('should send file via send(data:Blob) and set headers via onFileInfo', async () => {
    const peer: any = {
      defaultTargetId: 'c1',
      sendMessage: jest.fn(() => true),
      send: async (params: any) => params.onFileOrBlob(params.data),
      sendFile: async (params: any) => {
        await params.onFileInfo?.({ fileName: 'a.txt', mimeType: 'text/plain' });
        await params.stream.beforeStart?.({ stream: { streamId: 's1', _bind: () => void 0, start: async () => void 0 } });
        return;
      }
    };

    const res = new ServerResponseImpl('r3', '/p', 's1', peer);
    const ok = await res.send(new Blob(['x']));
    expect(ok).toBe(true);
    expect(res.headers[HttpHeader.CONTENT_TYPE]).toBe('text/plain');
    expect(String(res.headers[HttpHeader.CONTENT_DISPOSITION])).toContain('filename="a.txt"');
    expect(res._sent).toBe(true);
  });

  it('should reject when peer.sendMessage throws TARGET_WINDOW_CLOSED', async () => {
    const peer: any = {
      defaultTargetId: 'c1',
      sendMessage: jest.fn(() => {
        throw { code: 'TARGET_WINDOW_CLOSED' };
      }),
      send: async (params: any) => params.onOther(params.data)
    };

    const res = new ServerResponseImpl('r4', '/p', 's1', peer);
    await expect(res.send({ a: 1 }, { requireAck: false })).rejects.toBeDefined();
  });

  it('should send stream via peer.sendStream and markSent in beforeStart', async () => {
    const peer: any = {
      defaultTargetId: 'c1',
      sendMessage: jest.fn(() => true),
      sendStream: async (params: any) => {
        await params.beforeStart?.({ stream: params.stream });
        return;
      }
    };

    const res = new ServerResponseImpl('r5', '/p', 's1', peer);
    await res.sendStream({} as any);
    expect(res._sent).toBe(true);

    /** already sent => no-op */
    await res.sendStream({} as any);
  });

  it('sendFile should return false when already sent', async () => {
    const peer: any = {
      defaultTargetId: 'c1',
      sendMessage: jest.fn(() => true),
      sendFile: jest.fn(async () => void 0)
    };
    const res = new ServerResponseImpl('r6', '/p', 's1', peer);
    res._markSent();
    expect(await res.sendFile(new Blob(['x']))).toBe(false);
  });
});

