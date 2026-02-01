import { RequestIframeClientImpl } from '../src/impl/client';

describe('coverage: impl/client', () => {
  it('isConnect should reject when target window is unavailable', async () => {
    const closedWin: any = { closed: true, postMessage: jest.fn() };
    const client = new RequestIframeClientImpl(closedWin as any, '*', { autoOpen: false }, 'c1');
    await expect(client.isConnect()).rejects.toBeDefined();
  });
});

