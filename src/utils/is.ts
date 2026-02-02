export function isFunction<TArgs extends any[] = any[], TResult = any>(
  value: any
): value is (...args: TArgs) => TResult {
  return typeof value === 'function';
}

