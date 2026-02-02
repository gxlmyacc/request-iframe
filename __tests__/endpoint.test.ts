import { requestIframeEndpoint } from '../src/api/endpoint';
import { clearMessageChannelCache } from '../src/message/channel-cache';

describe('api/endpoint (requestIframeEndpoint) - facade', () => {
  beforeEach(() => {
    clearMessageChannelCache();
  });

  afterEach(() => {
    clearMessageChannelCache();
  });

  it('should create, open/close idempotent, and destroy', () => {
    const ep = requestIframeEndpoint(window as any, { autoOpen: false });
    expect(ep.isOpen).toBe(false);
    ep.open();
    ep.open();
    expect(ep.isOpen).toBe(true);
    ep.close();
    ep.close();
    expect(ep.isOpen).toBe(false);
    ep.destroy();
  });
});

