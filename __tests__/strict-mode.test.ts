import { requestIframeClient, requestIframeEndpoint, requestIframeServer } from '../src';

describe('strict mode defaults', () => {
  it('requestIframeClient(window) should default targetOrigin/allowedOrigins to current origin', () => {
    const client = requestIframeClient(window, { strict: true, secretKey: 'strict-client' }) as any;
    expect(client.targetOrigin).toBe(window.location.origin);
    client.destroy();
  });

  it('requestIframeEndpoint(window) should default targetOrigin/allowedOrigins to current origin', () => {
    const endpoint = requestIframeEndpoint(window, { strict: true, secretKey: 'strict-endpoint' }) as any;
    expect(endpoint.targetOrigin_).toBe(window.location.origin);
    endpoint.destroy();
  });

  it('requestIframeServer should not throw with strict enabled', () => {
    const server = requestIframeServer({ strict: true, secretKey: 'strict-server' });
    server.destroy();
  });
});

