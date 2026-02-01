import { requestIframeClient } from '../../src/api/client';
import { requestIframeServer } from '../../src/api/server';
import type { PostMessageData } from '../../src/types';
import { HttpHeader } from '../../src/constants';
import { IframeWritableStream } from '../../src/stream';
import { blobToText, createTestIframe, cleanupIframe, setupRequestIframeTestEnv } from '../test-utils/request-iframe';

setupRequestIframeTestEnv();

describe('requestIframe - client send various body types', () => {
  describe('client send various body types', () => {
    it('should send plain object and server receives JSON + Content-Type', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow: any = {
        postMessage: jest.fn((msg: PostMessageData) => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: msg,
              origin,
              source: mockContentWindow as any
            })
          );
        })
      };
      Object.defineProperty(iframe, 'contentWindow', { value: mockContentWindow, writable: true });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('echoObject', (req, res) => {
        expect(req.headers[HttpHeader.CONTENT_TYPE]).toBe('application/json');
        res.send({ ok: true, received: req.body });
      });

      const resp = await client.send<any>('echoObject', { a: 1 });
      expect((resp as any).data.ok).toBe(true);
      expect((resp as any).data.received).toEqual({ a: 1 });

      client.destroy();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should send string and server receives text/plain Content-Type', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow: any = {
        postMessage: jest.fn((msg: PostMessageData) => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: msg,
              origin,
              source: mockContentWindow as any
            })
          );
        })
      };
      Object.defineProperty(iframe, 'contentWindow', { value: mockContentWindow, writable: true });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('echoText', (req, res) => {
        expect(req.headers[HttpHeader.CONTENT_TYPE]).toContain('text/plain');
        res.send({ received: req.body, type: typeof req.body });
      });

      const resp = await client.send<any>('echoText', 'hello');
      expect((resp as any).data.received).toBe('hello');
      expect((resp as any).data.type).toBe('string');

      client.destroy();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should send URLSearchParams and server receives correct Content-Type', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow: any = {
        postMessage: jest.fn((msg: PostMessageData) => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: msg,
              origin,
              source: mockContentWindow as any
            })
          );
        })
      };
      Object.defineProperty(iframe, 'contentWindow', { value: mockContentWindow, writable: true });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('echoParams', (req, res) => {
        expect(req.headers[HttpHeader.CONTENT_TYPE]).toBe('application/x-www-form-urlencoded');
        // URLSearchParams should be structured-cloneable in modern browsers
        const value = req.body?.toString?.() ?? String(req.body);
        res.send({ received: value });
      });

      const params = new URLSearchParams({ a: '1', b: '2' });
      const resp = await client.send<any>('echoParams', params as any);
      expect((resp as any).data.received).toContain('a=1');
      expect((resp as any).data.received).toContain('b=2');

      client.destroy();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should auto-dispatch File/Blob body to client.sendFile and server receives file via stream (autoResolve)', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow: any = {
        postMessage: jest.fn((msg: PostMessageData) => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: msg,
              origin,
              source: mockContentWindow as any
            })
          );
        })
      };
      Object.defineProperty(iframe, 'contentWindow', { value: mockContentWindow, writable: true });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('uploadFile', async (req, res) => {
        expect(req.body).toBeDefined();
        const blob = req.body as Blob;
        const text = await blobToText(blob);
        res.send({ ok: true, text });
      });

      const blob = new Blob(['Hello Upload'], { type: 'text/plain' });
      const resp = await client.send<any>('uploadFile', blob);
      expect((resp as any).data.ok).toBe(true);
      expect((resp as any).data.text).toBe('Hello Upload');

      client.destroy();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should send stream from client to server and server receives req.stream', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow: any = {
        postMessage: jest.fn((msg: PostMessageData) => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: msg,
              origin,
              source: mockContentWindow as any
            })
          );
        })
      };
      Object.defineProperty(iframe, 'contentWindow', { value: mockContentWindow, writable: true });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('uploadStream', async (req, res) => {
        expect(req.stream).toBeDefined();
        const chunks: any[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const chunk of req.stream as any) {
          chunks.push(chunk);
        }
        res.send({ chunks });
      });

      const stream = new IframeWritableStream({
        iterator: async function* () {
          yield 'c1';
          yield 'c2';
          yield 'c3';
        }
      });

      const resp = await client.sendStream<any>('uploadStream', stream);
      expect((resp as any).data.chunks).toEqual(['c1', 'c2', 'c3']);

      client.destroy();
      server.destroy();
      cleanupIframe(iframe);
    });

    it('should support client.sendFile with autoResolve (server receives File/Blob in req.body)', async () => {
      const origin = 'https://example.com';
      const iframe = createTestIframe(origin);

      const mockContentWindow: any = {
        postMessage: jest.fn((msg: PostMessageData) => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: msg,
              origin,
              source: mockContentWindow as any
            })
          );
        })
      };
      Object.defineProperty(iframe, 'contentWindow', { value: mockContentWindow, writable: true });

      const client = requestIframeClient(iframe);
      const server = requestIframeServer();

      server.on('uploadFileStream', async (req, res) => {
        // autoResolve: server should get File/Blob directly
        expect(req.body).toBeDefined();
        expect(req.stream).toBeUndefined();
        const blob = req.body as Blob;
        const text = await blobToText(blob);
        res.send({ ok: true, text });
      });

      const blob = new Blob(['Hello Upload Stream'], { type: 'text/plain' });
      const resp = await client.sendFile<any>('uploadFileStream', blob, {
        autoResolve: true,
        mimeType: 'text/plain',
        fileName: 'upload.txt'
      });
      expect((resp as any).data.ok).toBe(true);
      expect((resp as any).data.text).toBe('Hello Upload Stream');

      client.destroy();
      server.destroy();
      cleanupIframe(iframe);
    });
  });
});

