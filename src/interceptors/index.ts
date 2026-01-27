import {
  RequestConfig,
  Response,
  InterceptorFunction
} from '../types';

/**
 * Interceptor manager
 */
export class InterceptorManager<T> {
  private handlers: Array<{
    fulfilled: InterceptorFunction<T>;
    rejected?: (error: any) => any;
  }> = [];

  /**
   * Add interceptor
   */
  use(
    fulfilled: InterceptorFunction<T>,
    rejected?: (error: any) => any
  ): number {
    this.handlers.push({ fulfilled, rejected });
    return this.handlers.length - 1;
  }

  /**
   * Remove interceptor
   */
  eject(id: number): void {
    if (this.handlers[id]) {
      this.handlers[id] = null as any;
    }
  }

  /**
   * Clear all interceptors
   */
  clear(): void {
    this.handlers.length = 0;
  }

  /**
   * Iterate over all interceptors
   */
  forEach(fn: (handler: { fulfilled: InterceptorFunction<T>; rejected?: (error: any) => any }) => void): void {
    this.handlers.forEach((h) => {
      if (h !== null) {
        fn(h);
      }
    });
  }
}

/**
 * Request interceptor manager
 */
export class RequestInterceptorManager extends InterceptorManager<RequestConfig> {}

/**
 * Response interceptor manager
 */
export class ResponseInterceptorManager extends InterceptorManager<Response> {}

/**
 * Execute request interceptor chain
 */
export async function runRequestInterceptors(
  interceptors: RequestInterceptorManager,
  config: RequestConfig
): Promise<RequestConfig> {
  let promise = Promise.resolve(config);

  interceptors.forEach((interceptor) => {
    promise = promise.then(
      (config) => interceptor.fulfilled(config),
      (error) => {
        if (interceptor.rejected) {
          return interceptor.rejected(error);
        }
        return Promise.reject(error);
      }
    );
  });

  return promise;
}

/**
 * Execute response interceptor chain
 */
export async function runResponseInterceptors(
  interceptors: ResponseInterceptorManager,
  response: Response
): Promise<Response> {
  let promise = Promise.resolve(response);

  interceptors.forEach((interceptor) => {
    promise = promise.then(
      (response) => interceptor.fulfilled(response),
      (error) => {
        if (interceptor.rejected) {
          return interceptor.rejected(error);
        }
        return Promise.reject(error);
      }
    );
  });

  return promise;
}
