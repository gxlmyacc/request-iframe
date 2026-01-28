import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  requestIframeClient,
  requestIframeServer,
  type RequestIframeClient,
  type RequestIframeClientOptions,
  type RequestIframeServer,
  type RequestIframeServerOptions,
  type ServerHandler
} from '../..';

/**
 * React hook for using request-iframe client
 * 
 * @param targetFnOrRef - function that returns iframe element or Window object, or a React ref object
 * @param options - client options
 * @param deps - dependency array (optional, for re-creating client when dependencies change)
 * @returns client instance
 * 
 * @example
 * ```tsx
 * // Using function
 * const MyComponent = () => {
 *   const iframeRef = useRef<HTMLIFrameElement>(null);
 *   const client = useClient(() => iframeRef.current, { secretKey: 'my-app' });
 * 
 *   const handleClick = async () => {
 *     if (client) {
 *       const response = await client.send('/api/data', { id: 1 });
 *       console.log(response.data);
 *     }
 *   };
 * 
 *   return (
 *     <div>
 *       <iframe ref={iframeRef} src="/iframe.html" />
 *       <button onClick={handleClick}>Send Request</button>
 *     </div>
 *   );
 * };
 * 
 * // Using ref directly
 * const MyComponent2 = () => {
 *   const iframeRef = useRef<HTMLIFrameElement>(null);
 *   const client = useClient(iframeRef, { secretKey: 'my-app' });
 *   // ...
 * };
 * ```
 */
export function useClient(
  targetFnOrRef: (() => HTMLIFrameElement | Window | null) | RefObject<HTMLIFrameElement | Window | null>,
  options?: RequestIframeClientOptions,
  deps?: readonly unknown[]
): RequestIframeClient | null {
  const [client, setClient] = useState<RequestIframeClient | null>(null);

  useEffect(() => {
    // Get current target
    const target = typeof targetFnOrRef === 'function' 
      ? targetFnOrRef() 
      : targetFnOrRef.current;

    // Destroy existing client if it exists
    if (client) {
      client.destroy();
      setClient(null);
    }

    // Only create client if target is available
    if (!target) {
      return;
    }

    // Create new client instance
    const newClient = requestIframeClient(target, options);
    setClient(newClient);

    // Cleanup: destroy client on unmount
    return () => {
      if (newClient) {
        newClient.destroy();
        setClient(null);
      }
    };
  }, deps !== undefined ? deps : []);

  return client;
}

/**
 * React hook for using request-iframe server
 * 
 * @param options - server options
 * @param deps - dependency array (optional, for re-creating server when dependencies change)
 * @returns server instance
 * 
 * @example
 * ```tsx
 * const MyComponent = () => {
 *   const server = useServer({ secretKey: 'my-app' });
 * 
 *   useEffect(() => {
 *     const off = server.on('/api/data', (req, res) => {
 *       res.send({ data: 'Hello' });
 *     });
 *     return off;
 *   }, [server]);
 * 
 *   return <div>Server Component</div>;
 * };
 * ```
 */
export function useServer(
  options?: RequestIframeServerOptions,
  deps?: readonly unknown[]
): RequestIframeServer | null {
  const [server, setServer] = useState<RequestIframeServer | null>(null);

  useEffect(() => {
    // Create server instance
    const newServer = requestIframeServer(options);
    setServer(newServer);

    // Cleanup: destroy server on unmount
    return () => {
      if (newServer) {
        newServer.destroy();
        setServer(null);
      }
    };
  }, deps !== undefined ? deps : []); // Only create once on mount by default

  return server;
}

/**
 * React hook for registering server handlers
 * 
 * @param server - server instance (from useServer)
 * @param path - route path
 * @param handler - handler function
 * @param deps - dependency array (optional, for re-registering when dependencies change)
 * 
 * @example
 * ```tsx
 * const MyComponent = () => {
 *   const server = useServer();
 *   const [userId, setUserId] = useState(1);
 * 
 *   // Register handler that depends on userId
 *   useServerHandler(server, '/api/user', (req, res) => {
 *     res.send({ userId, data: 'Hello' });
 *   }, [userId]);
 * 
 *   return <div>Server Component</div>;
 * };
 * ```
 */
export function useServerHandler(
  server: RequestIframeServer | null,
  path: string,
  handler: ServerHandler,
  deps: readonly unknown[]
): void {
  const handlerRef = useRef<ServerHandler>(handler);
  handlerRef.current = handler;

  const handlerWrapper = useCallback((req: any, res: any) => {
    return handlerRef.current?.(req, res);
  }, []);

  useEffect(() => {
    if (!server) {
      return;
    }

    // Register handler with stable wrapper
    const off = server.on(path, handlerWrapper);

    // Cleanup: unregister handler on unmount or when deps change
    return off;
  }, [server, path, handlerWrapper, ...(deps || [])]);
}

/**
 * React hook for registering server handlers map
 * 
 * @param server - server instance (from useServer)
 * @param map - map of route paths and handler functions
 * @param deps - dependency array (optional, for re-registering when dependencies change)
 * 
 * @example
 * ```tsx
 * const MyComponent = () => {
 *   const server = useServer();
 *   const [userId, setUserId] = useState(1);
 * 
 *   // Register handlers using map
 *   useServerHandlerMap(server, {
 *     '/api/user': (req, res) => {
 *       res.send({ userId, data: 'Hello' });
 *     },
 *     '/api/user2': (req, res) => {
 *       res.send({ userId, data: 'Hello' });
 *     }
 *   }, [userId]);
 * 
 *   return <div>Server Component</div>;
 * };
 * ```
 */
export function useServerHandlerMap(
  server: RequestIframeServer | null,
  map: Record<string, ServerHandler>,
  deps: readonly unknown[]
): void {
  const mapRef = useRef<Record<string, ServerHandler>>(map);
  mapRef.current = map;

  const keys = useMemo(() => {
    return Object.keys(map).sort();
  }, [map]);

  const mapWrapper = useMemo(() => {
    return keys.reduce((acc, key) => {
      acc[key] = function (req: any, res: any) {
        return mapRef.current?.[key]?.call(this, req, res);
      };
      return acc;
    }, {} as Record<string, ServerHandler>);
  }, [keys]);

  useEffect(() => {
    if (!server) {
      return;
    }
    // Register handlers using map with stable wrappers
    const off = server.map(mapWrapper);

    // Cleanup: unregister all handlers on unmount or when deps change
    return off;
  }, [server, mapWrapper, ...(deps || [])]);
}