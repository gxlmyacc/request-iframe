import { RequestIframeServerImpl } from '../src/impl/server';

describe('coverage: impl/server', () => {
  it('should cover use/off overload branches', () => {
    const server = new RequestIframeServerImpl({ autoOpen: false });

    server.use((req: any, res: any, next: any) => next());
    server.use('/p', (req: any, res: any, next: any) => next());
    /** no-op branch: missing middleware */
    server.use('/p' as any, undefined as any);

    server.off(['/a', '/b']);
    server.off('/a');

    server.destroy();
  });
});

