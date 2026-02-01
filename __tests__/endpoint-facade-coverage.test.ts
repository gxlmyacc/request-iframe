import { RequestIframeEndpointFacade } from '../src/endpoint/facade';
import { MessageRole, MessageType, OriginConstant } from '../src/constants';
import { createPostMessage } from '../src/utils/protocol';

describe('coverage: endpoint/facade (extra branches)', () => {
  it('handlePing branches (no source / origin blocked / includeTargetId)', () => {
    const f = new RequestIframeEndpointFacade({
      role: MessageRole.SERVER,
      instanceId: 's1'
    });
    const sendSpy = jest.spyOn(f.hub.messageDispatcher, 'sendMessage');

    /** no source -> ignore */
    f.handlePing(createPostMessage(MessageType.PING, 'p1', { role: MessageRole.CLIENT }), { origin: OriginConstant.ANY, source: undefined } as any, {
      handledBy: 'h',
      includeTargetId: true
    });
    expect(sendSpy).not.toHaveBeenCalled();

    /** origin blocked -> ignore */
    f.handlePing(createPostMessage(MessageType.PING, 'p2', { role: MessageRole.CLIENT }), { origin: OriginConstant.ANY, source: window } as any, {
      handledBy: 'h',
      includeTargetId: true,
      isOriginAllowed: () => false
    });
    expect(sendSpy).not.toHaveBeenCalled();

    /** includeTargetId -> reply */
    f.handlePing(createPostMessage(MessageType.PING, 'p3', { role: MessageRole.CLIENT, creatorId: 'c1' }), { origin: OriginConstant.ANY, source: window } as any, {
      handledBy: 'h',
      includeTargetId: true
    });
    expect(sendSpy).toHaveBeenCalled();
  });

  it('dispatchStreamMessage origin guard branch', () => {
    const f = new RequestIframeEndpointFacade({ role: MessageRole.SERVER, instanceId: 's2' });
    const spy = jest.spyOn(f.streamRouter, 'dispatch');

    f.dispatchStreamMessage(createPostMessage('stream_data' as any, 'r', { body: { streamId: 's', data: 'x' } }) as any, {} as any, {
      isOriginAllowed: () => false
    });
    expect(spy).not.toHaveBeenCalled();

    f.dispatchStreamMessage(createPostMessage('stream_data' as any, 'r', { body: { streamId: 's', data: 'x' } }) as any, {} as any);
    expect(spy).toHaveBeenCalled();
  });

  it('handleAck branches (origin guard / missing pending when closed / resolve)', () => {
    const f = new RequestIframeEndpointFacade({ role: MessageRole.SERVER, instanceId: 's3' });

    const warn = jest.fn();
    const resolve = jest.fn();

    /** origin guard */
    f.handleAck({
      data: createPostMessage(MessageType.ACK, 'r1', { role: MessageRole.CLIENT }) as any,
      context: { origin: OriginConstant.ANY } as any,
      handledBy: 'h',
      isOriginAllowed: () => false
    });

    /** missing pending when closed => warn */
    f.hub.close();
    f.handleAck({
      data: createPostMessage(MessageType.ACK, 'r2', { role: MessageRole.CLIENT }) as any,
      context: { origin: OriginConstant.ANY } as any,
      handledBy: 'h',
      warnMissingPendingWhenClosed: warn
    });
    expect(warn).toHaveBeenCalled();

    /** resolve */
    f.hub.open();
    f.registerPendingAck({ requestId: 'r3', timeoutMs: 1000, resolve });
    f.handleAck({
      data: createPostMessage(MessageType.ACK, 'r3', { role: MessageRole.CLIENT, ack: { id: 'a' } }) as any,
      context: { origin: OriginConstant.ANY, handledBy: undefined } as any,
      handledBy: 'h'
    });
    expect(resolve).toHaveBeenCalledWith(true, { id: 'a' });
  });

  it('handleIsConnectAck/handleIsConnectPong branches via private access', () => {
    const f = new RequestIframeEndpointFacade({ role: MessageRole.CLIENT, instanceId: 'c1' });
    const bucket = 'endpoint:pendingIsConnect';

    /** pending missing => false */
    expect((f as any).handleIsConnectAck(createPostMessage(MessageType.ACK, 'x') as any, { origin: OriginConstant.ANY } as any, { handledBy: 'h' })).toBe(false);

    /** set pending */
    const resolve = jest.fn();
    const timeoutId = setTimeout(() => void 0, 1);
    f.hub.pending.set(bucket, 'r1', { resolve, timeoutId, targetOrigin: 'https://ok', onPeerId: jest.fn() });

    /** coarse origin guard blocks */
    const ctx1: any = { origin: OriginConstant.ANY, handledBy: undefined, accepted: false };
    const ret1 = (f as any).handleIsConnectAck(createPostMessage(MessageType.ACK, 'r1', { creatorId: 's' }) as any, ctx1, {
      handledBy: 'h',
      isOriginAllowed: () => false
    });
    expect(ret1).toBe(true);
    expect(ctx1.handledBy).toBe('h');

    /** strict origin mismatch blocks */
    f.hub.pending.set(bucket, 'r2', { resolve, timeoutId, targetOrigin: 'https://ok', onPeerId: jest.fn() });
    const ctx2: any = { origin: 'https://bad', handledBy: undefined, accepted: false };
    const ret2 = (f as any).handleIsConnectPong(createPostMessage(MessageType.PONG, 'r2', { creatorId: 's' }) as any, ctx2, { handledBy: 'h' });
    expect(ret2).toBe(true);
    expect(ctx2.handledBy).toBe('h');

    /** success path */
    f.hub.pending.set(bucket, 'r3', { resolve, timeoutId, targetOrigin: 'https://ok', onPeerId: jest.fn() });
    const ctx3: any = { origin: 'https://ok', handledBy: undefined, accepted: false };
    const ret3 = (f as any).handleIsConnectPong(createPostMessage(MessageType.PONG, 'r3', { creatorId: 's' }) as any, ctx3, { handledBy: 'h' });
    expect(ret3).toBe(true);
    expect(resolve).toHaveBeenCalled();
  });
});

