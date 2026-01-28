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
  const clientRef = useRef<RequestIframeClient | null>(null);
  const [client, setClient] = useState<RequestIframeClient | null>(null);
  const lastTargetRef = useRef<HTMLIFrameElement | Window | null>(null);
  const targetFnOrRefRef = useRef(targetFnOrRef);
  const optionsRef = useRef(options);

  /** Keep latest inputs without re-creating effect deps */
  targetFnOrRefRef.current = targetFnOrRef;
  optionsRef.current = options;

  const getTarget = useCallback(() => {
    return typeof targetFnOrRefRef.current === 'function'
      ? targetFnOrRefRef.current()
      : targetFnOrRefRef.current.current;
  }, []);

  /**
   * Snapshot the current target during render (pure read).
   * We use this value as an effect dependency so the effect only runs when
   * the target actually changes (avoids StrictMode update-depth loops).
   */
  const target = getTarget();

  const destroy = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.destroy();
      clientRef.current = null;
    }
    lastTargetRef.current = null;
  }, []);

  /**
   * Create/destroy client in effect to be compatible with React 18 StrictMode
   * and concurrent rendering (avoid render-phase side effects).
   */
  useEffect(() => {
    /** If target unchanged, keep current client */
    if (target === lastTargetRef.current) return;

    /** Target changed: destroy old client and maybe create a new one */
    if (clientRef.current) {
      clientRef.current.destroy();
      clientRef.current = null;
    }

    lastTargetRef.current = target;

    if (!target) {
      setClient(null);
      return;
    }

    const newClient = requestIframeClient(target, optionsRef.current);
    clientRef.current = newClient;
    setClient(newClient);

    return () => {
      /** Cleanup only if it's still the current client */
      if (clientRef.current === newClient) {
        newClient.destroy();
        clientRef.current = null;
        lastTargetRef.current = null;
      }
    };
  }, (deps ? [...deps, target] : [target]) as unknown[]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroy();
    };
  }, []);

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
  const serverRef = useRef<RequestIframeServer | null>(null);
  const [server, setServer] = useState<RequestIframeServer | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const destroy = useCallback(() => {
    if (serverRef.current) {
      serverRef.current.destroy();
      serverRef.current = null;
    }
  }, []);

  /**
   * Create/destroy server in effect to be compatible with React 18 StrictMode
   * and concurrent rendering (avoid render-phase side effects).
   */
  useEffect(() => {
    if (serverRef.current) {
      serverRef.current.destroy();
      serverRef.current = null;
    }

    const newServer = requestIframeServer(optionsRef.current);
    serverRef.current = newServer;
    setServer(newServer);

    return () => {
      if (serverRef.current === newServer) {
        newServer.destroy();
        serverRef.current = null;
      }
    };
  }, (deps ?? []) as unknown[]);


  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroy();
    };
  }, []);

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