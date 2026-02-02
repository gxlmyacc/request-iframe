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
    const ctx = (p: { origin?: any; source?: any }) => {
      const c: any = { origin: p.origin ?? OriginConstant.ANY, source: p.source };
      c.handledBy = undefined;
      c.acceptedBy = undefined;
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

    /** no source -> ignore */
    f.handlePing(createPostMessage(MessageType.PING, 'p1', { role: MessageRole.CLIENT }), ctx({ source: undefined }), {
      handledBy: 'h',
      includeTargetId: true
    });
    expect(sendSpy).not.toHaveBeenCalled();

    /** origin blocked -> ignore */
    f.handlePing(createPostMessage(MessageType.PING, 'p2', { role: MessageRole.CLIENT }), ctx({ source: window }), {
      handledBy: 'h',
      includeTargetId: true,
      isOriginAllowed: () => false
    });
    expect(sendSpy).not.toHaveBeenCalled();

    /** includeTargetId -> reply */
    f.handlePing(createPostMessage(MessageType.PING, 'p3', { role: MessageRole.CLIENT, creatorId: 'c1' }), ctx({ source: window }), {
      handledBy: 'h',
      includeTargetId: true
    });
    expect(sendSpy).toHaveBeenCalled();
  });

  it('dispatchStreamMessage origin guard branch', () => {
    const f = new RequestIframeEndpointFacade({ role: MessageRole.SERVER, instanceId: 's2' });
    const spy = jest.spyOn(f.streamDispatcher, 'dispatch');

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
    const ctx = () => {
      const c: any = { origin: OriginConstant.ANY, handledBy: undefined, acceptedBy: undefined };
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

    /** origin guard */
    f.handleAck({
      data: createPostMessage(MessageType.ACK, 'r1', { role: MessageRole.CLIENT }) as any,
      context: ctx(),
      handledBy: 'h',
      isOriginAllowed: () => false
    });

    /** missing pending when closed => warn */
    f.hub.close();
    f.handleAck({
      data: createPostMessage(MessageType.ACK, 'r2', { role: MessageRole.CLIENT }) as any,
      context: ctx(),
      handledBy: 'h',
      warnMissingPendingWhenClosed: warn
    });
    expect(warn).toHaveBeenCalled();

    /** resolve */
    f.hub.open();
    f.registerPendingAck({ requestId: 'r3', timeoutMs: 1000, resolve });
    f.handleAck({
      data: createPostMessage(MessageType.ACK, 'r3', { role: MessageRole.CLIENT, ack: { id: 'a' } }) as any,
      context: ctx(),
      handledBy: 'h'
    });
    expect(resolve).toHaveBeenCalledWith(true, { id: 'a' });
  });

  it('isConnect handling is centralized in inbox (ACK/PONG branches)', async () => {
    jest.useFakeTimers();

    const f = new RequestIframeEndpointFacade({
      role: MessageRole.CLIENT,
      instanceId: 'c1',
      inbox: {}
    });
    const inbox: any = f.inbox as any;

    /** No pending -> should be a no-op */
    // Mark hub open to avoid "missing pending when closed" warn branch here.
    f.hub.open();
    const ctx0: any = { origin: OriginConstant.ANY, handledBy: undefined, acceptedBy: undefined };
    ctx0.markHandledBy = (handledBy: string) => {
      if (!ctx0.handledBy) ctx0.handledBy = handledBy;
    };
    ctx0.markAcceptedBy = (handledBy: string) => {
      if (!ctx0.acceptedBy) ctx0.acceptedBy = handledBy;
      ctx0.markHandledBy(handledBy);
    };
    ctx0.markDoneBy = (doneBy: string) => {
      ctx0.doneBy = doneBy;
    };
    ctx0.getStage = () => {
      if (ctx0.doneBy) return 'done';
      if (ctx0.acceptedBy) return 'accepted';
      if (ctx0.handledBy) return 'handling';
      return 'pending';
    };
    inbox.handleClientResponse(createPostMessage(MessageType.ACK, 'nope') as any, ctx0);
    expect(ctx0.handledBy).toBeUndefined();

    /** ACK origin mismatch -> mark handled but keep pending until timeout */
    const peer1: any = { sendMessage: jest.fn() };
    const onPeerId1 = jest.fn();
    const p1 = (f.inbox as any).pingIsConnect({
      peer: peer1,
      timeoutMs: 10,
      targetOrigin: 'https://ok',
      onPeerId: onPeerId1
    });
    const requestId1 = peer1.sendMessage.mock.calls[0][1];
    const ctx1: any = { origin: 'https://bad', handledBy: undefined, acceptedBy: undefined };
    ctx1.markHandledBy = (handledBy: string) => {
      if (!ctx1.handledBy) ctx1.handledBy = handledBy;
    };
    ctx1.markAcceptedBy = (handledBy: string) => {
      if (!ctx1.acceptedBy) ctx1.acceptedBy = handledBy;
      ctx1.markHandledBy(handledBy);
    };
    ctx1.markDoneBy = (doneBy: string) => {
      ctx1.doneBy = doneBy;
    };
    ctx1.getStage = () => {
      if (ctx1.doneBy) return 'done';
      if (ctx1.acceptedBy) return 'accepted';
      if (ctx1.handledBy) return 'handling';
      return 'pending';
    };
    inbox.handleClientResponse(createPostMessage(MessageType.ACK, requestId1, { creatorId: 's' }) as any, ctx1);
    expect(ctx1.acceptedBy).toBe('c1');
    expect(ctx1.handledBy).toBe('c1');
    jest.advanceTimersByTime(20);
    await expect(p1).resolves.toBe(false);

    /** PONG success -> resolve true + onPeerId */
    const peer2: any = { sendMessage: jest.fn() };
    const onPeerId2 = jest.fn();
    const p2 = (f.inbox as any).pingIsConnect({
      peer: peer2,
      timeoutMs: 100,
      targetOrigin: 'https://ok',
      onPeerId: onPeerId2
    });
    const requestId2 = peer2.sendMessage.mock.calls[0][1];
    const ctx2: any = { origin: 'https://ok', handledBy: undefined, acceptedBy: undefined };
    ctx2.markHandledBy = (handledBy: string) => {
      if (!ctx2.handledBy) ctx2.handledBy = handledBy;
    };
    ctx2.markAcceptedBy = (handledBy: string) => {
      if (!ctx2.acceptedBy) ctx2.acceptedBy = handledBy;
      ctx2.markHandledBy(handledBy);
    };
    ctx2.markDoneBy = (doneBy: string) => {
      ctx2.doneBy = doneBy;
    };
    ctx2.getStage = () => {
      if (ctx2.doneBy) return 'done';
      if (ctx2.acceptedBy) return 'accepted';
      if (ctx2.handledBy) return 'handling';
      return 'pending';
    };
    inbox.handlePong(createPostMessage(MessageType.PONG, requestId2, { creatorId: 's2' }) as any, ctx2);
    await expect(p2).resolves.toBe(true);
    expect(onPeerId2).toHaveBeenCalledWith('s2');

    jest.useRealTimers();
  });
});

