import { StreamEvent } from '../src/constants';
import { IframeStreamCore } from '../src/stream/stream-core';

class TestCore extends IframeStreamCore<any> {
  public emitPublic(event: string, payload?: any): void {
    this.emit(event, payload);
  }

  public endPublic(): void {
    this.end();
  }
}

describe('stream events (on/off/once)', () => {
  it('should support on/off unsubscribe', () => {
    const core = new TestCore('s1', 'data', true, undefined, true);
    const fn = jest.fn();
    const off = core.on(StreamEvent.DATA, fn);
    off();
    core.emitPublic(StreamEvent.DATA, { chunk: 1 });
    expect(fn).toHaveBeenCalledTimes(0);
  });

  it('should support once (fires only once)', () => {
    const core = new TestCore('s1', 'data', true, undefined, true);
    const fn = jest.fn();
    core.once(StreamEvent.DATA, fn);
    core.emitPublic(StreamEvent.DATA, { chunk: 1 });
    core.emitPublic(StreamEvent.DATA, { chunk: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('once(end) should fire immediately if already ended', () => {
    const core = new TestCore('s1', 'data', true, undefined, true);
    core.endPublic();
    const fn = jest.fn();
    core.once(StreamEvent.END, fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

