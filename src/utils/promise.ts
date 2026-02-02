export function isPromise<T>(value: any): value is Promise<T>  {
  return value !== null && typeof value === 'object' && 'then' in value;
}

