import { IframeStreamCore } from '../src/stream/stream-core';
import { StreamState as StreamStateConstant, StreamType as StreamTypeConstant } from '../src/constants';

class TestDuplexCore extends IframeStreamCore<any> {
  public _notify(): void {
    (this as any).notifyWaiters();
  }
  public _waitForChange(): Promise<void> {
    return (this as any).waitForChange();
  }
  public _pushChunk(v: any): void {
    (this as any).pushChunk(v);
  }
  public _fail(err: Error): void {
    (this as any).fail(err);
  }
  public _cancel(reason?: string): void {
    (this as any).cancel(reason);
  }
  public _end(): void {
    (this as any).end();
  }
  public get _chunks(): any[] {
    return (this as any).chunks;
  }
  public get _waiters(): Array<() => void> {
    return (this as any).waiters;
  }
  public set _stateValue(v: any) {
    (this as any)._state = v;
  }
  public get _terminalError(): Error | undefined {
    return (this as any).terminalError;
  }
}

describe('stream/stream-core (IframeStreamCore)', () => {
  it('notifyWaiters should early-return when no waiters', () => {
    const core = new TestDuplexCore('sid', StreamTypeConstant.DATA as any, true, undefined, true);
    expect(core._waiters.length).toBe(0);
    core._notify();
    expect(core._waiters.length).toBe(0);
  });

  it('notifyWaiters should ignore waiter errors and continue', () => {
    const core = new TestDuplexCore('sid', StreamTypeConstant.DATA as any, true, undefined, true);
    let ok = false;
    core._waiters.push(() => {
      throw new Error('boom');
    });
    core._waiters.push(() => {
      ok = true;
    });
    core._notify();
    expect(ok).toBe(true);
    expect(core._waiters.length).toBe(0);
  });

  it('waitForChange should resolve immediately for terminal states', async () => {
    const core = new TestDuplexCore('sid', StreamTypeConstant.DATA as any, true, undefined, true);
    core._end();
    await expect(core._waitForChange()).resolves.toBeUndefined();
  });

  it('waitForChange should resolve when notified', async () => {
    const core = new TestDuplexCore('sid', StreamTypeConstant.DATA as any, true, undefined, true);
    const p = core._waitForChange();
    core._pushChunk(1);
    await expect(p).resolves.toBeUndefined();
  });

  it('pushChunk should only work in pending/streaming', () => {
    const core = new TestDuplexCore('sid', StreamTypeConstant.DATA as any, true, undefined, true);
    core._pushChunk('a');
    expect(core.state).toBe(StreamStateConstant.STREAMING);
    expect(core._chunks).toEqual(['a']);

    core._fail(new Error('x'));
    expect(core.state).toBe(StreamStateConstant.ERROR);
    core._pushChunk('b');
    expect(core._chunks).toEqual(['a']);
  });

  it('fail should be idempotent and no-op after ended', () => {
    const core = new TestDuplexCore('sid', StreamTypeConstant.DATA as any, true, undefined, true);
    const err = new Error('e1');
    core._fail(err);
    expect(core.state).toBe(StreamStateConstant.ERROR);
    expect(core._terminalError).toBe(err);

    core._end();
    const before = core.state;
    core._fail(new Error('e2'));
    expect(core.state).toBe(before);
  });

  it('cancel should set CANCELLED and be idempotent', () => {
    const core = new TestDuplexCore('sid', StreamTypeConstant.DATA as any, true, undefined, true);
    core._cancel('reason');
    expect(core.state).toBe(StreamStateConstant.CANCELLED);
    expect(core._terminalError).toBeInstanceOf(Error);

    core._cancel('reason2');
    expect(core.state).toBe(StreamStateConstant.CANCELLED);
  });

  it('end should be idempotent', () => {
    const core = new TestDuplexCore('sid', StreamTypeConstant.DATA as any, true, undefined, true);
    core._end();
    expect(core.state).toBe(StreamStateConstant.ENDED);
    core._end();
    expect(core.state).toBe(StreamStateConstant.ENDED);
  });
});

