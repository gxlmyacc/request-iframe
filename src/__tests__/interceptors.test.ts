import {
  InterceptorManager,
  RequestInterceptorManager,
  ResponseInterceptorManager,
  runRequestInterceptors,
  runResponseInterceptors
} from '../interceptors';
import { RequestConfig, Response } from '../types';

describe('interceptors', () => {
  describe('InterceptorManager', () => {
    it('should add and remove interceptors', () => {
      const manager = new InterceptorManager<RequestConfig>();
      const interceptor = jest.fn((config) => config);

      const id = manager.use(interceptor);
      expect(typeof id).toBe('number');

      manager.eject(id);
      manager.forEach((handler) => {
        expect(handler).not.toBe(interceptor);
      });
    });

    it('should iterate over all interceptors', () => {
      const manager = new InterceptorManager<RequestConfig>();
      const interceptor1 = jest.fn((config) => config);
      const interceptor2 = jest.fn((config) => config);

      manager.use(interceptor1);
      manager.use(interceptor2);

      const handlers: any[] = [];
      manager.forEach((handler) => {
        handlers.push(handler.fulfilled);
      });

      expect(handlers).toContain(interceptor1);
      expect(handlers).toContain(interceptor2);
    });
  });

  describe('runRequestInterceptors', () => {
    it('should execute request interceptors in order', async () => {
      const manager = new RequestInterceptorManager();
      const order: number[] = [];

      manager.use(async (config) => {
        order.push(1);
        return config;
      });

      manager.use(async (config) => {
        order.push(2);
        return config;
      });

      const config: RequestConfig = { path: 'test' };
      await runRequestInterceptors(manager, config);

      expect(order).toEqual([1, 2]);
    });

    it('should be able to modify config', async () => {
      const manager = new RequestInterceptorManager();

      manager.use((config) => {
        config.body = { modified: true };
        return config;
      });

      const config: RequestConfig = { path: 'test' };
      const result = await runRequestInterceptors(manager, config);

      expect(result.body).toEqual({ modified: true });
    });
  });

  describe('runResponseInterceptors', () => {
    it('should execute response interceptors in order', async () => {
      const manager = new ResponseInterceptorManager();
      const order: number[] = [];

      manager.use(async (response) => {
        order.push(1);
        return response;
      });

      manager.use(async (response) => {
        order.push(2);
        return response;
      });

      const response: Response = {
        data: {},
        status: 200,
        statusText: 'OK',
        requestId: 'req123'
      };
      await runResponseInterceptors(manager, response);

      expect(order).toEqual([1, 2]);
    });

    it('should be able to modify response', async () => {
      const manager = new ResponseInterceptorManager();

      manager.use((response) => {
        response.data = { modified: true };
        return response;
      });

      const response: Response = {
        data: {},
        status: 200,
        statusText: 'OK',
        requestId: 'req123'
      };
      const result = await runResponseInterceptors(manager, response);

      expect(result.data).toEqual({ modified: true });
    });
  });
});
