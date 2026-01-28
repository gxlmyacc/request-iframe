# request-iframe

Communicate with iframes like sending HTTP requests! A cross-origin iframe communication library based on `postMessage`.

> 🌐 **Languages**: [English](./README.md) | [中文](./README.CN.md)

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-Ready-blue" alt="TypeScript Ready">
  <img src="https://img.shields.io/badge/API-Express%20Like-green" alt="Express Like API">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License">
  <img src="https://img.shields.io/badge/Test%20Coverage-76%25-brightgreen" alt="Test Coverage">
</p>

## 📑 Table of Contents

- [Why request-iframe?](#why-request-iframe)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Use Cases](#use-cases)
- [How It Works](#how-it-works)
  - [Communication Protocol](#communication-protocol)
  - [Message Types](#message-types)
  - [Timeout Mechanism](#timeout-mechanism)
  - [Protocol Version](#protocol-version)
- [Detailed Features](#detailed-features)
  - [Interceptors](#interceptors)
  - [Middleware](#middleware)
  - [Headers and Cookies](#headers-and-cookies)
  - [File Transfer](#file-transfer)
  - [Streaming](#streaming)
  - [Connection Detection](#connection-detection)
  - [Response Acknowledgment](#response-acknowledgment)
  - [Trace Mode](#trace-mode)
  - [Internationalization](#internationalization)
- [API Reference](#api-reference)
- [React Hooks](#react-hooks)
  - [useClient](#useclienttargetfnorref-options-deps)
  - [useServer](#useserveroptions-deps)
  - [useServerHandler](#useserverhandlerserver-path-handler-deps)
  - [useServerHandlerMap](#useserverhandlermapserver-map-deps)
  - [Complete Example](#complete-example)
  - [Best Practices](#best-practices)
- [Error Handling](#error-handling)
- [FAQ](#faq)
- [Development](#development)
- [License](#license)

## Why request-iframe?

In micro-frontend and iframe nesting scenarios, parent-child page communication is a common requirement. Traditional `postMessage` communication has the following pain points:

| Pain Point | Traditional Way | request-iframe |
|------------|----------------|----------------|
| Request-Response Association | Manual requestId management | Automatic management, Promise style |
| Timeout Handling | Manual timer implementation | Built-in multi-stage timeout mechanism |
| Error Handling | Various edge cases | Standardized error codes |
| Message Isolation | Easy to cross-talk | secretKey automatic isolation |
| API Style | Event listener style | HTTP-like request/Express style |
| TypeScript | Need custom types | Full type support |
| Test Coverage | None | 76%+ test coverage |

**Core Advantages**:
- ✅ **Zero Learning Curve** - If you're familiar with axios and Express, you can get started immediately
- ✅ **Type Safe** - Full TypeScript support for a great development experience
- ✅ **Production Ready** - High test coverage, thoroughly tested
- ✅ **Feature Rich** - Interceptors, middleware, streaming, file transfer all included

## Features

- 🚀 **HTTP-like Style** - Client sends requests, Server handles and responds, just like axios + express
- 🔌 **Interceptor Support** - Request/response interceptors for unified authentication, logging, etc.
- 🎭 **Middleware Mechanism** - Express-style middleware with path matching support
- ⏱️ **Smart Timeout** - Three-stage timeout (connection/sync/async), automatically detects long tasks
- 📦 **TypeScript** - Complete type definitions and IntelliSense
- 🔒 **Message Isolation** - secretKey mechanism prevents message cross-talk between multiple instances
- 📁 **File Transfer** - Support for base64-encoded file sending
- 🌊 **Streaming** - Support for large file chunked transfer, supports async iterators
- 🌍 **Internationalization** - Error messages can be customized for i18n
- ✅ **Protocol Versioning** - Built-in version control for upgrade compatibility

## Installation

```bash
npm install request-iframe
# or
yarn add request-iframe
# or
pnpm add request-iframe
```

**Requirements**: Node.js >= 14

**TypeScript**: Built-in complete type definitions, no need to install `@types/request-iframe`

## Quick Start

### 1. Parent Page (Client Side)

```typescript
import { requestIframeClient } from 'request-iframe';

// Get iframe element
const iframe = document.querySelector('iframe')!;

// Create client
const client = requestIframeClient(iframe, { secretKey: 'my-app' });

// Send request (just like axios)
const response = await client.send('/api/getUserInfo', { userId: 123 });
console.log(response.data); // { name: 'Tom', age: 18 }
```

### 2. iframe Page (Server Side)

```typescript
import { requestIframeServer } from 'request-iframe';

// Create server
const server = requestIframeServer({ secretKey: 'my-app' });

// Register handler (just like express)
server.on('/api/getUserInfo', (req, res) => {
  const { userId } = req.body;
  res.send({ name: 'Tom', age: 18 });
});
```

That's it! 🎉

> 💡 **Tip**: For more quick start guides, see [QUICKSTART.md](./QUICKSTART.md) or [QUICKSTART.CN.md](./QUICKSTART.CN.md) (中文)

---

## Use Cases

### Micro-Frontend Communication

In micro-frontend architecture, the main application needs to communicate with child application iframes:

```typescript
// Main application (parent page)
const client = requestIframeClient(iframe, { secretKey: 'main-app' });

// Get user info from child application
const userInfo = await client.send('/api/user/info', {});

// Notify child application to refresh data
await client.send('/api/data/refresh', { timestamp: Date.now() });
```

### Third-Party Component Integration

When integrating third-party components, isolate via iframe while maintaining communication:

```typescript
// Parent page
const client = requestIframeClient(thirdPartyIframe, { secretKey: 'widget' });

// Configure component
await client.send('/config', {
  theme: 'dark',
  language: 'en-US'
});

// Listen to component events (via reverse communication)
const server = requestIframeServer({ secretKey: 'widget-events' });
server.on('/event', (req, res) => {
  console.log('Component event:', req.body);
  res.send({ received: true });
});
```

### Cross-Origin Data Fetching

When iframe and parent page are on different origins, use request-iframe to securely fetch data:

```typescript
// Inside iframe (different origin)
const server = requestIframeServer({ secretKey: 'data-api' });

server.on('/api/data', async (req, res) => {
  // Fetch data from same-origin API (iframe can access same-origin resources)
  const data = await fetch('/api/internal/data').then(r => r.json());
  res.send(data);
});

// Parent page (cross-origin)
const client = requestIframeClient(iframe, { secretKey: 'data-api' });
const data = await client.send('/api/data', {}); // Successfully fetch cross-origin data
```

### File Preview and Download

Process files in iframe, then transfer to parent page:

```typescript
// Inside iframe: process file and return
server.on('/api/processFile', async (req, res) => {
  const { fileId } = req.body;
  const processedFile = await processFile(fileId);
  
  // Return processed file
  await res.sendFile(processedFile, {
    mimeType: 'application/pdf',
    fileName: `processed-${fileId}.pdf`
  });
});

// Parent page: download file
const response = await client.send('/api/processFile', { fileId: '123' });
if (response.fileData) {
  downloadFile(response.fileData);
}
```

---

## How It Works

### Communication Protocol

request-iframe implements an HTTP-like communication protocol on top of `postMessage`:

```
  Client (Parent Page)                      Server (iframe)
       │                                          │
       │  ──── REQUEST ────────────────────────>  │  Send request
       │                                          │
       │  <──── ACK ───────────────────────────  │  Acknowledge receipt
       │                                          │
       │                                          │  Execute handler
       │                                          │
       │  <──── ASYNC (optional) ───────────────  │  If handler returns Promise
       │                                          │
       │  <──── RESPONSE ──────────────────────  │  Return result
       │                                          │
       │  ──── RECEIVED (optional) ────────────>  │  Acknowledge receipt of response
       │                                          │
```

### Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `request` | Client → Server | Client initiates request |
| `ack` | Server → Client | Server acknowledges receipt of request |
| `async` | Server → Client | Notifies client this is an async task (sent when handler returns Promise) |
| `response` | Server → Client | Returns response data |
| `error` | Server → Client | Returns error information |
| `received` | Client → Server | Client acknowledges receipt of response (optional, controlled by `requireAck`) |
| `ping` | Client → Server | Connection detection (`isConnect()` method) |
| `pong` | Server → Client | Connection detection response |

### Timeout Mechanism

request-iframe uses a three-stage timeout strategy to intelligently adapt to different scenarios:

```typescript
client.send('/api/getData', data, {
  ackTimeout: 1000,       // Stage 1: ACK timeout (default 1000ms)
  timeout: 5000,          // Stage 2: Request timeout (default 5s)
  asyncTimeout: 120000    // Stage 3: Async request timeout (default 120s)
});
```

**Timeout Flow:**

```
Send REQUEST
    │
    ▼
┌───────────────────┐    timeout    ┌─────────────────────────────┐
│ ackTimeout        │ ────────────> │ Error: ACK_TIMEOUT          │
│ (wait for ACK)    │                │ "Connection failed, Server  │
└───────────────────┘                │  not responding"           │
    │                                 └─────────────────────────────┘
    │ ACK received
    ▼
┌───────────────────┐    timeout    ┌─────────────────────────────┐
│ timeout           │ ────────────> │ Error: TIMEOUT               │
│ (wait for RESPONSE)│                │ "Request timeout"            │
└───────────────────┘                └─────────────────────────────┘
    │
    │ ASYNC received (optional)
    ▼
┌───────────────────┐    timeout    ┌─────────────────────────────┐
│ asyncTimeout      │ ────────────> │ Error: ASYNC_TIMEOUT         │
│ (wait for RESPONSE)│                │ "Async request timeout"      │
└───────────────────┘                └─────────────────────────────┘
    │
    │ RESPONSE received
    ▼
  Request Complete ✓
```

**Why This Design?**

| Stage | Timeout | Scenario |
|-------|---------|----------|
| ackTimeout | Short (1000ms) | Quickly detect if Server is online, avoid long waits for unreachable iframes. Increased from 500ms to accommodate slower environments or busy browsers |
| timeout | Medium (5s) | Suitable for simple synchronous processing, like reading data, parameter validation |
| asyncTimeout | Long (120s) | Suitable for complex async operations, like file processing, batch operations, third-party API calls |

### Protocol Version

Each message contains a `__requestIframe__` field identifying the protocol version, and a `timestamp` field recording message creation time:

```typescript
{
  __requestIframe__: 1,  // Protocol version number
  timestamp: 1704067200000,  // Message creation timestamp (milliseconds)
  type: 'request',
  requestId: 'req_xxx',
  path: '/api/getData',
  body: { ... }
}
```

This enables:
- Different library versions can handle compatibility
- New version Server can be compatible with old version Client
- Clear error messages when version is too low
- `timestamp` facilitates debugging message delays and analyzing communication performance

---

## Detailed Features

### Interceptors

#### Request Interceptors

```typescript
// Add request interceptor (unified token addition)
client.interceptors.request.use((config) => {
  config.headers = {
    ...config.headers,
    'Authorization': `Bearer ${getToken()}`
  };
  return config;
});

// Error handling
client.interceptors.request.use(
  (config) => config,
  (error) => {
    console.error('Request config error:', error);
    return Promise.reject(error);
  }
);
```

#### Response Interceptors

```typescript
// Add response interceptor (unified data transformation)
client.interceptors.response.use((response) => {
  // Assume backend returns { code: 0, data: {...} } format
  if (response.data.code === 0) {
    response.data = response.data.data;
  }
  return response;
});

// Error handling
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'TIMEOUT') {
      message.error('Request timeout, please retry');
    }
    return Promise.reject(error);
  }
);
```

### Middleware

Server side supports Express-style middleware:

#### Global Middleware

```typescript
// Logging middleware
server.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.path}`, req.body);
  next();
});

// Authentication middleware
server.use((req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) {
    return res.status(401).send({ error: 'Unauthorized' });
  }
  // Verify token...
  next();
});
```

#### Path-Matching Middleware

```typescript
// Only applies to /api/* paths
server.use('/api/*', (req, res, next) => {
  console.log('API request:', req.path);
  next();
});

// Regex matching
server.use(/^\/admin\//, (req, res, next) => {
  // Special handling for admin interfaces
  next();
});

// Array matching
server.use(['/user', '/profile'], (req, res, next) => {
  // User-related interfaces
  next();
});
```

### Headers and Cookies

> **Note**: The `headers` and `cookies` here are not real browser HTTP Headers and Cookies, but a **message metadata passing mechanism** simulated by request-iframe in HTTP style. Data is passed between iframes via `postMessage` and does not affect the browser's real Cookie storage.

**Why This Design?**

| Design Purpose | Description |
|----------------|-------------|
| **API Style Consistency** | Consistent usage with HTTP requests (axios/fetch) and server-side (Express) |
| **Lower Learning Curve** | Developers familiar with HTTP can get started quickly without learning new APIs |
| **Third-Party Library Compatibility** | Easy to reuse or adapt Express middleware, authentication libraries, etc., with minimal changes |
| **Cross-iframe State Sharing** | Implement login state passing, permission validation between different iframes, solving state synchronization issues caused by iframe isolation |
| **Flexible Data Passing** | Provides additional metadata channels beyond body, facilitating layered processing (e.g., middleware reads headers, business logic reads body) |

#### Automatic Cookie Management

request-iframe simulates HTTP's automatic cookie management mechanism:

**How It Works (Similar to HTTP Set-Cookie):**

1. **When Server sets cookie**: Generate `Set-Cookie` string via `res.cookie(name, value, options)`
2. **When response returns**: All `Set-Cookie` stored in `headers['Set-Cookie']` array
3. **After Client receives response**: Parse `Set-Cookie` header, save to Cookie storage based on Path and other attributes
4. **When Client sends request**: Only carry **path-matched** cookies (similar to browser behavior)

```typescript
// Server side: Set token on login (supports full Cookie options)
server.on('/api/login', (req, res) => {
  const { username, password } = req.body;
  // Verify user...
  
  // Set cookie (supports path, expires, maxAge, httpOnly, etc.)
  res.cookie('authToken', 'jwt_xxx', { path: '/api', httpOnly: true });
  res.cookie('userId', '12345', { path: '/' });
  res.send({ success: true });
});

// Server side: Read token in subsequent interfaces (client automatically carries path-matched cookies)
server.on('/api/getUserInfo', (req, res) => {
  const token = req.cookies['authToken'];  // Path matched, automatically carried
  const userId = req.cookies['userId'];     // Root path cookie, carried in all requests
  // Verify token...
  res.send({ name: 'Tom', age: 18 });
});

// Server side: Clear cookie
server.on('/api/logout', (req, res) => {
  res.clearCookie('authToken', { path: '/api' });
  res.send({ success: true });
});
```

```typescript
// Client side: Login
await client.send('/api/login', { username: 'tom', password: '123' });

// Client side: Subsequent request to /api/getUserInfo (automatically carries authToken and userId)
const userInfo = await client.send('/api/getUserInfo', {});

// Client side: Request root path (only carries userId, because authToken's path is /api)
const rootData = await client.send('/other', {});
```

#### Client Cookie Management API

Client provides manual cookie management APIs with **path isolation** support:

```typescript
// Get all cookies
client.getCookies();  // { authToken: 'jwt_xxx', userId: '12345' }

// Get cookies matching specified path
client.getCookies('/api');  // Only returns cookies matching /api

// Get specified cookie
client.getCookie('authToken');  // 'jwt_xxx'
client.getCookie('authToken', '/api');  // Get with specified path

// Manually set cookie (supports path options)
client.setCookie('theme', 'dark');  // Default path '/'
client.setCookie('apiConfig', 'v2', { path: '/api' });  // Specify path
client.setCookie('temp', 'xxx', { maxAge: 3600 });  // Expires in 1 hour

// Delete specified cookie
client.removeCookie('theme');  // Delete theme with path '/'
client.removeCookie('apiConfig', '/api');  // Delete cookie with specified path

// Clear all cookies (e.g., on logout)
client.clearCookies();
```

#### Headers Usage Example

```typescript
// Client side: Send custom headers
const response = await client.send('/api/data', {}, {
  headers: {
    'X-Device-Id': 'device-123',
    'X-Platform': 'web',
    'Authorization': 'Bearer xxx'  // Can also pass token via headers
  }
});

// Server side: Read and set headers
server.on('/api/data', (req, res) => {
  // Read request headers
  const deviceId = req.headers['x-device-id'];
  const platform = req.headers['x-platform'];
  
  // Set response headers
  res.setHeader('X-Request-Id', req.requestId);
  res.set('X-Custom-Header', 'value');  // Chainable
  
  res.send({ data: 'ok' });
});
```

### File Transfer

```typescript
// Server side: Send file
server.on('/api/download', async (req, res) => {
  // String content
  await res.sendFile('Hello, World!', {
    mimeType: 'text/plain',
    fileName: 'hello.txt'
  });
  
  // Or Blob/File object
  const blob = new Blob(['binary data'], { type: 'application/octet-stream' });
  await res.sendFile(blob, { fileName: 'data.bin' });
});

// Client side: Receive
const response = await client.send('/api/download', {});
if (response.fileData) {
  const { content, mimeType, fileName } = response.fileData;
  
  // content is base64-encoded string
  const binaryString = atob(content);
  const blob = new Blob([binaryString], { type: mimeType });
  
  // Download file
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'download';
  a.click();
}
```

### Streaming

For large files or scenarios requiring chunked transfer, you can use streaming:

```typescript
import { 
  IframeWritableStream, 
  IframeFileWritableStream,
  isIframeReadableStream,
  isIframeFileStream 
} from 'request-iframe';

// Server side: Send data stream using iterator
server.on('/api/stream', async (req, res) => {
  const stream = new IframeWritableStream({
    type: 'data',
    chunked: true,
    // Generate data using async iterator
    iterator: async function* () {
      for (let i = 0; i < 10; i++) {
        yield { chunk: i, data: `Data chunk ${i}` };
        await new Promise(r => setTimeout(r, 100)); // Simulate delay
      }
    }
  });
  
  await res.sendStream(stream);
});

// Client side: Receive stream data
const response = await client.send('/api/stream', {});

// Check if it's a stream response
if (isIframeReadableStream(response.stream)) {
  // Method 1: Read all data at once
  const allData = await response.stream.read();
  
  // Method 2: Read chunk by chunk using async iterator
  for await (const chunk of response.stream) {
    console.log('Received chunk:', chunk);
  }
  
  // Listen to stream end
  response.stream.onEnd(() => {
    console.log('Stream ended');
  });
  
  // Listen to stream error
  response.stream.onError((error) => {
    console.error('Stream error:', error);
  });
  
  // Cancel stream
  response.stream.cancel('User cancelled');
}
```

**Stream Types:**

| Type | Description |
|------|-------------|
| `IframeWritableStream` | Server-side writable stream for sending regular data |
| `IframeFileWritableStream` | Server-side file writable stream, automatically handles base64 encoding |
| `IframeReadableStream` | Client-side readable stream for receiving regular data |
| `IframeFileReadableStream` | Client-side file readable stream, automatically handles base64 decoding |

### Connection Detection

```typescript
// Detect if Server is reachable
const isConnected = await client.isConnect();
if (isConnected) {
  console.log('Connection OK');
} else {
  console.log('Connection failed');
}
```

### Response Acknowledgment

Server can require Client to acknowledge receipt of response:

```typescript
server.on('/api/important', async (req, res) => {
  // requireAck: true means client needs to acknowledge
  const received = await res.send(data, { requireAck: true });
  
  if (received) {
    console.log('Client acknowledged receipt');
  } else {
    console.log('Client did not acknowledge (timeout)');
  }
});
```

### Trace Mode

Enable trace mode to view detailed communication logs in console:

```typescript
const client = requestIframeClient(iframe, { 
  secretKey: 'demo',
  trace: true 
});

const server = requestIframeServer({ 
  secretKey: 'demo',
  trace: true 
});

// Console output:
// [request-iframe] [INFO] 📤 Request Start { path: '/api/getData', ... }
// [request-iframe] [INFO] 📨 ACK Received { requestId: '...' }
// [request-iframe] [INFO] ✅ Request Success { status: 200, data: {...} }
```

### Internationalization

```typescript
import { setMessages } from 'request-iframe';

// Switch to Chinese
setMessages({
  ACK_TIMEOUT: 'ACK acknowledgment timeout, waited {0} milliseconds',
  REQUEST_TIMEOUT: 'Request timeout, waited {0} milliseconds',
  REQUEST_FAILED: 'Request failed',
  METHOD_NOT_FOUND: 'Method not found',
  MIDDLEWARE_ERROR: 'Middleware error',
  IFRAME_NOT_READY: 'iframe not ready'
});
```

---

## API Reference

### requestIframeClient(target, options?)

Create a Client instance.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `HTMLIFrameElement \| Window` | Target iframe element or window object |
| `options.secretKey` | `string` | Message isolation identifier (optional) |
| `options.trace` | `boolean` | Whether to enable trace mode (optional) |
| `options.ackTimeout` | `number` | Global default ACK acknowledgment timeout (ms), default 1000 |
| `options.timeout` | `number` | Global default request timeout (ms), default 5000 |
| `options.asyncTimeout` | `number` | Global default async timeout (ms), default 120000 |

**Returns:** `RequestIframeClient`

### requestIframeServer(options?)

Create a Server instance.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.secretKey` | `string` | Message isolation identifier (optional) |
| `options.trace` | `boolean` | Whether to enable trace mode (optional) |
| `options.ackTimeout` | `number` | Wait for client acknowledgment timeout (ms), default 1000 |

**Returns:** `RequestIframeServer`

### Client API

#### client.send(path, body?, options?)

Send a request.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Request path |
| `body` | `object` | Request data (optional) |
| `options.ackTimeout` | `number` | ACK acknowledgment timeout (ms), default 1000 |
| `options.timeout` | `number` | Request timeout (ms), default 5000 |
| `options.asyncTimeout` | `number` | Async timeout (ms), default 120000 |
| `options.headers` | `object` | Request headers (optional) |
| `options.cookies` | `object` | Request cookies (optional, merged with internally stored cookies, passed-in takes priority) |
| `options.requestId` | `string` | Custom request ID (optional) |

**Returns:** `Promise<Response>`

```typescript
interface Response<T = any> {
  data: T;                    // Response data (File/Blob for auto-resolved file streams)
  status: number;             // Status code
  statusText: string;         // Status text
  requestId: string;          // Request ID
  headers?: Record<string, string | string[]>;  // Response headers (Set-Cookie is array)
  stream?: IIframeReadableStream<T>;  // Stream response (if any)
}
```

#### client.isConnect()

Detect if Server is reachable.

**Returns:** `Promise<boolean>`

#### client.interceptors

Interceptor manager.

```typescript
// Request interceptor
client.interceptors.request.use(onFulfilled, onRejected?);

// Response interceptor
client.interceptors.response.use(onFulfilled, onRejected?);
```

### Server API

#### server.on(path, handler)

Register route handler.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Request path |
| `handler` | `ServerHandler` | Handler function |

```typescript
type ServerHandler = (req: ServerRequest, res: ServerResponse) => any | Promise<any>;
```

#### server.off(path)

Remove route handler.

#### server.map(handlers)

Batch register handlers.

```typescript
server.map({
  '/api/users': (req, res) => res.send([...]),
  '/api/posts': (req, res) => res.send([...])
});
```

#### server.use(middleware)
#### server.use(path, middleware)

Register middleware.

```typescript
// Global middleware
server.use((req, res, next) => { ... });

// Path-matching middleware
server.use('/api/*', (req, res, next) => { ... });
server.use(/^\/admin/, (req, res, next) => { ... });
server.use(['/a', '/b'], (req, res, next) => { ... });
```

#### server.destroy()

Destroy Server instance, remove all listeners.

---

## React Hooks

request-iframe provides React hooks for easy integration in React applications. Import hooks from `request-iframe/react`:

```typescript
import { useClient, useServer, useServerHandler, useServerHandlerMap } from 'request-iframe/react';
```

### useClient(targetFnOrRef, options?, deps?)

React hook for using request-iframe client.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `targetFnOrRef` | `(() => HTMLIFrameElement \| Window \| null) \| RefObject<HTMLIFrameElement \| Window>` | Function that returns iframe element or Window object, or a React ref object |
| `options` | `RequestIframeClientOptions` | Client options (optional) |
| `deps` | `readonly unknown[]` | Dependency array (optional, for re-creating client when dependencies change) |

**Returns:** `RequestIframeClient | null`

**Example:**

```tsx
import { useClient } from 'request-iframe/react';
import { useRef } from 'react';

const MyComponent = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const client = useClient(iframeRef, { secretKey: 'my-app' });

  const handleClick = async () => {
    if (client) {
      const response = await client.send('/api/data', { id: 1 });
      console.log(response.data);
    }
  };

  return (
    <div>
      <iframe ref={iframeRef} src="/iframe.html" />
      <button onClick={handleClick}>Send Request</button>
    </div>
  );
};
```

**Using function instead of ref:**

```tsx
const MyComponent = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const client = useClient(() => iframeRef.current, { secretKey: 'my-app' });
  // ...
};
```

### useServer(options?, deps?)

React hook for using request-iframe server.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `options` | `RequestIframeServerOptions` | Server options (optional) |
| `deps` | `readonly unknown[]` | Dependency array (optional, for re-creating server when dependencies change) |

**Returns:** `RequestIframeServer | null`

**Example:**

```tsx
import { useServer } from 'request-iframe/react';

const MyComponent = () => {
  const server = useServer({ secretKey: 'my-app' });

  useEffect(() => {
    if (!server) return;

    const off = server.on('/api/data', (req, res) => {
      res.send({ data: 'Hello' });
    });

    return off; // Cleanup on unmount
  }, [server]);

  return <div>Server Component</div>;
};
```

### useServerHandler(server, path, handler, deps?)

React hook for registering a single server handler with automatic cleanup and closure handling.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `server` | `RequestIframeServer \| null` | Server instance (from `useServer`) |
| `path` | `string` | Route path |
| `handler` | `ServerHandler` | Handler function |
| `deps` | `readonly unknown[]` | Dependency array (optional, for re-registering when dependencies change) |

**Example:**

```tsx
import { useServer, useServerHandler } from 'request-iframe/react';
import { useState } from 'react';

const MyComponent = () => {
  const server = useServer();
  const [userId, setUserId] = useState(1);

  // Handler automatically uses latest userId value
  useServerHandler(server, '/api/user', (req, res) => {
    res.send({ userId, data: 'Hello' });
  }, [userId]); // Re-register when userId changes

  return <div>Server Component</div>;
};
```

**Key Features:**
- Automatically handles closure issues - always uses latest values from dependencies
- Automatically unregisters handler on unmount or when dependencies change
- No need to manually manage handler registration/cleanup

### useServerHandlerMap(server, map, deps?)

React hook for registering multiple server handlers at once with automatic cleanup.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `server` | `RequestIframeServer \| null` | Server instance (from `useServer`) |
| `map` | `Record<string, ServerHandler>` | Map of route paths and handler functions |
| `deps` | `readonly unknown[]` | Dependency array (optional, for re-registering when dependencies change) |

**Example:**

```tsx
import { useServer, useServerHandlerMap } from 'request-iframe/react';
import { useState } from 'react';

const MyComponent = () => {
  const server = useServer();
  const [userId, setUserId] = useState(1);

  // Register multiple handlers at once
  useServerHandlerMap(server, {
    '/api/user': (req, res) => {
      res.send({ userId, data: 'User data' });
    },
    '/api/posts': (req, res) => {
      res.send({ userId, data: 'Posts data' });
    }
  }, [userId]); // Re-register all handlers when userId changes

  return <div>Server Component</div>;
};
```

**Key Features:**
- Batch registration of multiple handlers
- Automatically handles closure issues - always uses latest values from dependencies
- Automatically unregisters all handlers on unmount or when dependencies change
- Efficient - only re-registers when map keys change

### Complete Example

Here's a complete example showing how to use React hooks in a real application:

```tsx
import { useClient, useServer, useServerHandler } from 'request-iframe/react';
import { useRef, useState } from 'react';

// Parent Component (Client)
const ParentComponent = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const client = useClient(iframeRef, { secretKey: 'my-app' });
  const [data, setData] = useState(null);

  const fetchData = async () => {
    if (!client) return;
    
    try {
      const response = await client.send('/api/data', { id: 1 });
      setData(response.data);
    } catch (error) {
      console.error('Request failed:', error);
    }
  };

  return (
    <div>
      <iframe ref={iframeRef} src="/iframe.html" />
      <button onClick={fetchData}>Fetch Data</button>
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
};

// Iframe Component (Server)
const IframeComponent = () => {
  const server = useServer({ secretKey: 'my-app' });
  const [userId, setUserId] = useState(1);

  // Register handler with automatic cleanup
  useServerHandler(server, '/api/data', async (req, res) => {
    // Handler always uses latest userId value
    const userData = await fetchUserData(userId);
    res.send(userData);
  }, [userId]);

  return (
    <div>
      <p>User ID: {userId}</p>
      <button onClick={() => setUserId(userId + 1)}>Increment</button>
    </div>
  );
};
```

### Best Practices

1. **Always check for null**: Client and server hooks may return `null` initially or when target is unavailable:
   ```tsx
   const client = useClient(iframeRef);
   if (!client) return null; // Handle null case
   ```

2. **Use dependency arrays**: Pass dependencies to hooks to ensure handlers use latest values:
   ```tsx
   useServerHandler(server, '/api/data', (req, res) => {
     res.send({ userId }); // Always uses latest userId
   }, [userId]); // Re-register when userId changes
   ```

3. **Cleanup is automatic**: Hooks automatically clean up on unmount, but you can also manually unregister:
   ```tsx
   useEffect(() => {
     if (!server) return;
     const off = server.on('/api/data', handler);
     return off; // Manual cleanup (optional, hooks do this automatically)
   }, [server]);
   ```

---

## Error Handling

### Error Codes

| Error Code | Description |
|------------|-------------|
| `ACK_TIMEOUT` | ACK acknowledgment timeout (did not receive ACK) |
| `TIMEOUT` | Synchronous request timeout |
| `ASYNC_TIMEOUT` | Async request timeout |
| `REQUEST_ERROR` | Request processing error |
| `METHOD_NOT_FOUND` | Handler not found |
| `NO_RESPONSE` | Handler did not send response |
| `PROTOCOL_UNSUPPORTED` | Protocol version not supported |
| `IFRAME_NOT_READY` | iframe not ready |
| `STREAM_ERROR` | Stream transfer error |
| `STREAM_CANCELLED` | Stream cancelled |
| `STREAM_NOT_BOUND` | Stream not bound to request context |

### Error Handling Example

```typescript
try {
  const response = await client.send('/api/getData', { id: 1 });
} catch (error) {
  switch (error.code) {
    case 'ACK_TIMEOUT':
      console.error('Cannot connect to iframe');
      break;
    case 'TIMEOUT':
      console.error('Request timeout');
      break;
    case 'METHOD_NOT_FOUND':
      console.error('Interface does not exist');
      break;
    default:
      console.error('Request failed:', error.message);
  }
}
```

---

## FAQ

### 1. What is secretKey used for?

`secretKey` is used for message isolation. When there are multiple iframes or multiple request-iframe instances on a page, using different `secretKey` values can prevent message cross-talk:

```typescript
// Communication for iframe A
const clientA = requestIframeClient(iframeA, { secretKey: 'app-a' });
const serverA = requestIframeServer({ secretKey: 'app-a' });

// Communication for iframe B
const clientB = requestIframeClient(iframeB, { secretKey: 'app-b' });
const serverB = requestIframeServer({ secretKey: 'app-b' });
```

### 2. Why is ACK acknowledgment needed?

ACK mechanism is similar to TCP handshake, used for:
1. Quickly confirm if Server is online
2. Distinguish between "connection failure" and "request timeout"
3. Support timeout switching for async tasks

### 3. How to handle iframe cross-origin?

`postMessage` itself supports cross-origin communication, request-iframe handles it automatically:

```typescript
// Parent page (https://parent.com)
const client = requestIframeClient(iframe);

// Inside iframe (https://child.com)
const server = requestIframeServer();
```

Just ensure both sides use the same `secretKey`.

### 4. Can Server actively push messages?

request-iframe is request-response mode, Server cannot actively push. For bidirectional communication, you can create a Client inside the iframe:

```typescript
// Inside iframe
const server = requestIframeServer({ secretKey: 'my-app' });
const client = requestIframeClient(window.parent, { secretKey: 'my-app-reverse' });

// Actively send message to parent page
await client.send('/notify', { event: 'data-changed' });
```

### 5. How to debug communication issues?

1. **Enable trace mode**: View detailed communication logs
2. **Check secretKey**: Ensure Client and Server use the same secretKey
3. **Check iframe loading**: Ensure iframe is fully loaded
4. **Check console**: Check for cross-origin errors

---

## Development

### Requirements

- Node.js >= 14
- npm >= 6 or yarn >= 1.22

### Development Commands

```bash
# Install dependencies
npm install
# or
yarn install

# Run tests
npm test
# or
yarn test

# Run tests (watch mode)
npm run test:watch
# or
yarn test:watch

# Generate test coverage report
npm run test:coverage
# or
yarn test:coverage

# Code linting
npm run lint
# or
yarn lint

# Auto-fix code issues
npm run lint:fix
# or
yarn lint:fix

# Build project
npm run build
# or
yarn build
```

### Test Coverage

The project currently has **76.88%** test coverage, meeting production requirements:

- **Statement Coverage**: 76.88%
- **Branch Coverage**: 64.13%
- **Function Coverage**: 75%
- **Line Coverage**: 78.71%

Coverage reports are generated in the `coverage/` directory, view detailed coverage report via `coverage/index.html`.

### Browser Compatibility

| Browser | Minimum Version | Notes |
|---------|----------------|-------|
| Chrome | 49+ | Full support |
| Firefox | 45+ | Full support |
| Safari | 10+ | Full support |
| Edge | 12+ | Full support |
| IE | Not supported | May support IE 11 with Babel transpilation, but not tested |

### Related Projects

- [axios](https://github.com/axios/axios) - HTTP client library that inspired this project
- [Express](https://expressjs.com/) - Server API design reference

## License

MIT License
