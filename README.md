# request-iframe

Communicate with iframes/windows like sending HTTP requests! A cross-origin browser communication library based on `postMessage`.

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

In micro-frontend, iframe nesting, and popup window scenarios, cross-page communication is a common requirement. Traditional `postMessage` communication has the following pain points:

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
- 📁 **File Transfer** - File transfer via streams (client↔server)
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
const userInfoResponse = await client.send('/api/user/info', {});
console.log(userInfoResponse.data); // User info data

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
const server = requestIframeServer({ secretKey: 'widget' });
server.on('/event', (req, res) => {
  console.log('Component event:', req.body);
  res.send({ received: true });
});
```

### Popup / New Window (Window Communication)

`request-iframe` also works with a `Window` target (not only an iframe).

**Important**: you must have a real `Window` reference (e.g. returned by `window.open()`, or available via `window.opener` / `event.source`). You cannot send to an arbitrary browser tab by URL.

```typescript
// Parent page: open a new tab/window
const child = window.open('https://child.example.com/page.html', '_blank');
if (!child) throw new Error('Popup blocked');

// Parent -> child
const client = requestIframeClient(child, {
  secretKey: 'popup-demo',
  targetOrigin: 'https://child.example.com' // strongly recommended (avoid '*')
});
await client.send('/api/ping', { from: 'parent' });

// Child page: create server
const server = requestIframeServer({ secretKey: 'popup-demo' });
server.on('/api/ping', (req, res) => res.send({ ok: true, echo: req.body }));
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
const response = await client.send('/api/data', {});
const data = response.data; // Successfully fetch cross-origin data
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
if (response.data instanceof File || response.data instanceof Blob) {
  downloadFile(response.data);
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
       │  <──── ACK (optional) ────────────────  │  Acknowledge receipt (controlled by request `requireAck`, default true)
       │                                          │
       │                                          │  Execute handler
       │                                          │
       │  <──── ASYNC (optional) ───────────────  │  If handler returns Promise
       │                                          │
       │  <──── RESPONSE ──────────────────────  │  Return result
       │                                          │
       │  ──── RECEIVED (optional) ────────────>  │  Acknowledge receipt of response/error (controlled by response `requireAck`)
       │                                          │
```

### Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `request` | Client → Server | Client initiates request |
| `ack` | Server → Client | Server acknowledges receipt of request (when request `requireAck` is enabled) |
| `async` | Server → Client | Notifies client this is an async task (sent when handler returns Promise) |
| `response` | Server → Client | Returns response data |
| `error` | Server → Client | Returns error information |
| `received` | Client → Server | Client acknowledges receipt of response/error (optional, controlled by response `requireAck`) |
| `ping` | Client → Server | Connection detection (`isConnect()` method, may use `requireAck` to confirm delivery) |
| `pong` | Server → Client | Connection detection response |
| `stream_pull` | Receiver → Sender | Stream pull: receiver requests next chunks (pull/ack protocol) |
| `stream_ack` | Receiver → Sender | Stream ack: receiver acknowledges a chunk (pull/ack protocol) |

### Timeout Mechanism

request-iframe uses a three-stage timeout strategy to intelligently adapt to different scenarios:

```typescript
client.send('/api/getData', data, {
  ackTimeout: 1000,       // Stage 1: ACK timeout (default 1000ms)
  timeout: 5000,          // Stage 2: Request timeout (default 5s)
  asyncTimeout: 120000,   // Stage 3: Async request timeout (default 120s)
  requireAck: true        // Whether to wait for server ACK before switching to stage 2 (default true)
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

**Notes:**
- If you set `requireAck: false`, the request will **skip** the ACK stage and start `timeout` immediately.
- Stream transfer has its own optional idle timeout: use `streamTimeout` (see [Streaming](#streaming)).

### Protocol Version

Each message contains a `__requestIframe__` field identifying the protocol version, and a `timestamp` field recording message creation time:

```typescript
{
  __requestIframe__: 2,  // Protocol version number
  timestamp: 1704067200000,  // Message creation timestamp (milliseconds)
  type: 'request',
  requestId: 'req_xxx',
  path: '/api/getData',
  body: { ... }
}
```

This enables:
- Different library versions can handle compatibility
- Current protocol version is `2`. For the new stream pull/ack flow, both sides should use the same version.
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

**Cookie Lifetime (Important):**

- **In-memory only**: Cookies are stored in the Client instance's internal `CookieStore` (not the browser's real cookies).
- **Lifecycle**: By default, cookies live **from `requestIframeClient()` creation until `client.destroy()`**.
- **`open()` / `close()`**: These only enable/disable message handling; they **do not clear** the internal cookies.
- **Expiration**: `Expires` / `Max-Age` are respected. Expired cookies are automatically filtered out when reading/sending (and can be removed via `client.clearCookies()` / `client.removeCookie()`).

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
const userInfoResponse = await client.send('/api/getUserInfo', {});
const userInfo = userInfoResponse.data;

// Client side: Request root path (only carries userId, because authToken's path is /api)
const rootResponse = await client.send('/other', {});
const rootData = rootResponse.data;
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

> Note: File transfer (both Client→Server and Server→Client) is carried by the stream protocol under the hood. You normally only need to use `client.sendFile()` / `res.sendFile()`.

#### Server → Client (Server sends file to client)

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
if (response.data instanceof File || response.data instanceof Blob) {
  const file = response.data instanceof File ? response.data : null;
  const fileName = file?.name || 'download';
  
  // Download file directly using File/Blob
  const url = URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
```

#### Client → Server (Client sends file to server)

Client sends file using `sendFile()` (or `send(path, file)`); server receives either `req.body` as File/Blob when `autoResolve: true` (default), or `req.stream` as `IframeFileReadableStream` when `autoResolve: false`.

```typescript
// Client side: Send file (stream, autoResolve defaults to true)
const file = new File(['Hello Upload'], 'upload.txt', { type: 'text/plain' });
const response = await client.send('/api/upload', file);

// Or use sendFile explicitly
const blob = new Blob(['binary data'], { type: 'application/octet-stream' });
const response2 = await client.sendFile('/api/upload', blob, {
  fileName: 'data.bin',
  mimeType: 'application/octet-stream',
  autoResolve: true  // optional, default true: server gets File/Blob in req.body
});

// Server side: Receive file (autoResolve true → req.body is File/Blob)
server.on('/api/upload', async (req, res) => {
  const blob = req.body as Blob;  // or File when client sent File
  const text = await blob.text();
  console.log('Received file content:', text);
  res.send({ success: true, size: blob.size });
});
```

**Note:** When using `client.send()` with a `File` or `Blob`, it automatically dispatches to `client.sendFile()`. Server gets `req.body` as File/Blob when `autoResolve` is true (default), or `req.stream` / `req.body` as `IframeFileReadableStream` when `autoResolve` is false.

### Streaming

Streaming is not only for large/chunked transfers, but also works well for **long-lived subscription-style interactions** (similar to SSE/WebSocket, but built on top of `postMessage`).

#### Long-lived subscription (push mode)

> Notes:
> - `IframeWritableStream` defaults `expireTimeout` to `asyncTimeout` to avoid leaking long-lived streams. For real subscriptions, set a larger `expireTimeout`, or set `expireTimeout: 0` to disable auto-expire (use with care and pair with cancel/reconnect).
> - `res.sendStream(stream)` waits until the stream ends. If you want to keep pushing via `write()`, **do not** `await` it; use `void res.sendStream(stream)` or keep the returned Promise.
> - If `maxConcurrentRequestsPerClient` is enabled, a long-lived stream occupies one in-flight request slot.
> - **Event subscription**: streams support `stream.on(event, listener)` (returns an unsubscribe function) for observability (e.g. `start/data/read/write/cancel/end/error/timeout/expired`). For consuming data, prefer `for await`.

```typescript
/**
 * Server side: subscribe (long-lived)
 * - mode: 'push': writer calls write()
 * - expireTimeout: 0: disable auto-expire (use with care)
 */
server.on('/api/subscribe', (req, res) => {
  const stream = new IframeWritableStream({
    type: 'data',
    chunked: true,
    mode: 'push',
    expireTimeout: 0,
    /** optional: writer-side idle timeout while waiting for pull/ack */
    streamTimeout: 15000
  });

  /** do not await, otherwise it blocks until stream ends */
  void res.sendStream(stream);

  const timer = setInterval(() => {
    try {
      stream.write({ type: 'tick', ts: Date.now() });
    } catch {
      clearInterval(timer);
    }
  }, 1000);
});

/**
 * Client side: consume continuously (prefer for-await for long-lived streams)
 */
const resp = await client.send('/api/subscribe', {});
if (isIframeReadableStream(resp.stream)) {
  /** Optional: observe events */
  const off = resp.stream.on(StreamEvent.ERROR, ({ error }) => {
    console.error('stream error:', error);
  });

  for await (const evt of resp.stream) {
    console.log('event:', evt);
  }

  off();
}
```

#### Server → Client (Server sends stream to client)

```typescript
import {
  StreamEvent,
  IframeWritableStream, 
  IframeFileWritableStream,
  isIframeReadableStream,
  isIframeFileReadableStream 
} from 'request-iframe';

// Server side: Send data stream using iterator
server.on('/api/stream', async (req, res) => {
  const stream = new IframeWritableStream({
    type: 'data',
    chunked: true,
    mode: 'pull', // default: pull/ack protocol (backpressure)
    // Optional: auto-expire stream to avoid leaking resources (default: asyncTimeout)
    // expireTimeout: 120000,
    // Optional: writer-side idle timeout while waiting for pull/ack
    // streamTimeout: 10000,
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
const response = await client.send('/api/stream', {}, { streamTimeout: 10000 });

// Check if it's a stream response
if (isIframeReadableStream(response.stream)) {
  // Sender stream mode (from stream_start)
  console.log('Stream mode:', response.stream.mode); // 'pull' | 'push' | undefined

  // Method 1: Read all data at once
  const allData = await response.stream.read();
  // If you want a consistent return type (always an array of chunks), use readAll()
  const allChunks = await response.stream.readAll();
  
  // Method 2: Read chunk by chunk using async iterator (consume defaults to true)
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

#### Client → Server (Client sends stream to server)

```typescript
import { IframeWritableStream } from 'request-iframe';

// Client side: Send stream to server
const stream = new IframeWritableStream({
  chunked: true,
  iterator: async function* () {
    for (let i = 0; i < 5; i++) {
      yield `Chunk ${i}`;
      await new Promise(r => setTimeout(r, 50));
    }
  }
});

// Use sendStream to send stream as request body
const response = await client.sendStream('/api/uploadStream', stream);
console.log('Upload result:', response.data);

// Or use send() - it automatically dispatches to sendStream for IframeWritableStream
const stream2 = new IframeWritableStream({
  next: async () => ({ data: 'single chunk', done: true })
});
const response2 = await client.send('/api/uploadStream', stream2);

// Server side: Receive stream
server.on('/api/uploadStream', async (req, res) => {
  // req.stream is available when client sends stream
  if (req.stream) {
    const chunks: string[] = [];
    
    // Read stream chunk by chunk
    for await (const chunk of req.stream) {
      chunks.push(chunk);
      console.log('Received chunk:', chunk);
    }
    
    res.send({ 
      success: true, 
      chunkCount: chunks.length,
      chunks 
    });
  } else {
    res.status(400).send({ error: 'Expected stream body' });
  }
});
```

**Stream Types:**

| Type | Description |
|------|-------------|
| `IframeWritableStream` | Writer/producer stream: **created by whichever side is sending the stream** (server→client response stream, or client→server request stream) |
| `IframeFileWritableStream` | File writer/producer stream (base64-encodes internally) |
| `IframeReadableStream` | Reader/consumer stream for receiving regular data (regardless of which side sent it) |
| `IframeFileReadableStream` | File reader/consumer stream (base64-decodes internally) |

> **Note**: File streams are base64-encoded internally. Base64 introduces ~33% size overhead and can be memory/CPU heavy for very large files. For large files, prefer **chunked** file streams (`chunked: true`) and keep chunk sizes moderate (e.g. 256KB–1MB).

**Stream timeouts:**
- `options.streamTimeout` (request option): client-side stream idle timeout while consuming `response.stream` (data/file streams). When triggered, the client will attempt a heartbeat check and fail the stream if the connection is not alive.
- `expireTimeout` (writable stream option): writer-side stream lifetime. When expired, the writer sends `stream_error` and the reader will fail the stream with `STREAM_EXPIRED`.
- `streamTimeout` (writable stream option): writer-side idle timeout. If the writer does not receive `stream_pull/stream_ack` for a long time, it will heartbeat-check and fail to avoid wasting resources.

**Pull/Ack protocol (default):**
- Reader automatically sends `stream_pull` to request chunks and sends `stream_ack` for each received chunk.
- Writer only sends `stream_data` when it has received `stream_pull`, enabling real backpressure.

**consume default change:**
- `for await (const chunk of response.stream)` defaults to **consume and drop** already iterated chunks (`consume: true`) to prevent unbounded memory growth for long streams.

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

> **Note**: Client acknowledgment (`received`) is sent automatically by the library when the response/error is accepted by the client (i.e., there is a matching pending request). You don't need to manually send `received`.

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
| `options.targetOrigin` | `string` | Override postMessage targetOrigin for sending (optional). If `target` is a `Window`, default is `*`. |
| `options.ackTimeout` | `number` | Global default ACK acknowledgment timeout (ms), default 1000 |
| `options.timeout` | `number` | Global default request timeout (ms), default 5000 |
| `options.asyncTimeout` | `number` | Global default async timeout (ms), default 120000 |
| `options.requireAck` | `boolean` | Global default for request delivery ACK (default true). If false, requests skip the ACK stage and start `timeout` immediately |
| `options.streamTimeout` | `number` | Global default stream idle timeout (ms) when consuming `response.stream` (optional) |
| `options.allowedOrigins` | `string \| RegExp \| Array<string \| RegExp>` | Allowlist for incoming message origins (optional, recommended for production) |
| `options.validateOrigin` | `(origin, data, context) => boolean` | Custom origin validator (optional, higher priority than `allowedOrigins`) |

**Returns:** `RequestIframeClient`

**Notes about `target: Window`:**
- **You must have a `Window` reference** (e.g. from `window.open()`, `window.opener`, or `MessageEvent.source`).
- You **cannot** communicate with an arbitrary browser tab by URL.
- For security, prefer setting a strict `targetOrigin` and configure `allowedOrigins` / `validateOrigin`.

### requestIframeServer(options?)

Create a Server instance.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.secretKey` | `string` | Message isolation identifier (optional) |
| `options.trace` | `boolean` | Whether to enable trace mode (optional) |
| `options.ackTimeout` | `number` | Wait for client acknowledgment timeout (ms), default 1000 |
| `options.maxConcurrentRequestsPerClient` | `number` | Max concurrent in-flight requests per client (per origin + creatorId). Default Infinity |
| `options.allowedOrigins` | `string \| RegExp \| Array<string \| RegExp>` | Allowlist for incoming message origins (optional, recommended for production) |
| `options.validateOrigin` | `(origin, data, context) => boolean` | Custom origin validator (optional, higher priority than `allowedOrigins`) |

**Returns:** `RequestIframeServer`

### Client API

#### client.send(path, body?, options?)

Send a request. Automatically dispatches to `sendFile()` or `sendStream()` based on body type.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Request path |
| `body` | `any` | Request data (optional). Can be plain object, File, Blob, or IframeWritableStream. Automatically dispatches: File/Blob → `sendFile()`, IframeWritableStream → `sendStream()` |
| `options.ackTimeout` | `number` | ACK acknowledgment timeout (ms), default 1000 |
| `options.timeout` | `number` | Request timeout (ms), default 5000 |
| `options.asyncTimeout` | `number` | Async timeout (ms), default 120000 |
| `options.requireAck` | `boolean` | Whether to require server delivery ACK (default true). If false, skips ACK stage |
| `options.streamTimeout` | `number` | Stream idle timeout (ms) while consuming `response.stream` (optional) |
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

**Examples:**

```typescript
// Send plain object (auto Content-Type: application/json)
await client.send('/api/data', { name: 'test' });

// Send string (auto Content-Type: text/plain)
await client.send('/api/text', 'Hello');

// Send File/Blob (auto-dispatches to sendFile)
const file = new File(['content'], 'test.txt');
await client.send('/api/upload', file);

// Send stream (auto-dispatches to sendStream)
const stream = new IframeWritableStream({ iterator: async function* () { yield 'data'; } });
await client.send('/api/uploadStream', stream);
```

#### client.sendFile(path, content, options?)

Send file as request body (via stream; server receives File/Blob when autoResolve is true).

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Request path |
| `content` | `string \| Blob \| File` | File content to send |
| `options.mimeType` | `string` | File MIME type (optional, uses content.type if available) |
| `options.fileName` | `string` | File name (optional) |
| `options.autoResolve` | `boolean` | If true (default), server receives File/Blob in `req.body`; if false, server gets `req.stream` / `req.body` as `IframeFileReadableStream` |
| `options.ackTimeout` | `number` | ACK acknowledgment timeout (ms), default 1000 |
| `options.timeout` | `number` | Request timeout (ms), default 5000 |
| `options.asyncTimeout` | `number` | Async timeout (ms), default 120000 |
| `options.requireAck` | `boolean` | Whether to require server delivery ACK (default true). If false, skips ACK stage |
| `options.streamTimeout` | `number` | Stream idle timeout (ms) while consuming `response.stream` (optional) |
| `options.headers` | `object` | Request headers (optional) |
| `options.cookies` | `object` | Request cookies (optional) |
| `options.requestId` | `string` | Custom request ID (optional) |

**Returns:** `Promise<Response>`

**Note:** The file is sent via stream. When `autoResolve` is true (default), the server receives `req.body` as File/Blob; when false, the server receives `req.stream` / `req.body` as `IframeFileReadableStream`.

#### client.sendStream(path, stream, options?)

Send stream as request body (server receives readable stream).

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Request path |
| `stream` | `IframeWritableStream` | Writable stream to send |
| `options.ackTimeout` | `number` | ACK acknowledgment timeout (ms), default 1000 |
| `options.timeout` | `number` | Request timeout (ms), default 5000 |
| `options.asyncTimeout` | `number` | Async timeout (ms), default 120000 |
| `options.requireAck` | `boolean` | Whether to require server delivery ACK (default true). If false, skips ACK stage |
| `options.streamTimeout` | `number` | Stream idle timeout (ms) while consuming `response.stream` (optional) |
| `options.headers` | `object` | Request headers (optional) |
| `options.cookies` | `object` | Request cookies (optional) |
| `options.requestId` | `string` | Custom request ID (optional) |

**Returns:** `Promise<Response>`

**Note:** On the server side, the stream is available as `req.stream` (an `IIframeReadableStream`). You can iterate over it using `for await (const chunk of req.stream)`.

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

**ServerRequest interface:**

```typescript
interface ServerRequest {
  body: any;                    // Request body (plain data, or File/Blob when client sendFile with autoResolve true)
  stream?: IIframeReadableStream; // Request stream (when client sends via sendStream or sendFile with autoResolve false)
  headers: Record<string, string>; // Request headers
  cookies: Record<string, string>;  // Request cookies
  path: string;                 // Request path
  params: Record<string, string>; // Path parameters extracted from route pattern (e.g., { id: '123' } for '/api/users/:id' and '/api/users/123')
  requestId: string;            // Request ID
  origin: string;               // Sender origin
  source: Window;                // Sender window
  res: ServerResponse;          // Response object
}
```

**Note:** 
- When client sends a file via `sendFile()` (or `send(path, file)`), the file is sent via stream. If `autoResolve` is true (default), `req.body` is the resolved File/Blob; if false, `req.stream` / `req.body` is an `IIframeReadableStream` (e.g. `IframeFileReadableStream`).
- When client sends a stream via `sendStream()`, `req.stream` is available as an `IIframeReadableStream`. You can iterate over it using `for await (const chunk of req.stream)`.
- **Path parameters**: You can use Express-style route parameters (e.g., `/api/users/:id`) to extract path segments. The extracted parameters are available in `req.params`. For example, registering `/api/users/:id` and receiving `/api/users/123` will set `req.params.id` to `'123'`.

**Path Parameters Example:**

```typescript
// Register route with parameter
server.on('/api/users/:id', (req, res) => {
  const userId = req.params.id; // '123' when path is '/api/users/123'
  res.send({ userId });
});

// Multiple parameters
server.on('/api/users/:userId/posts/:postId', (req, res) => {
  const { userId, postId } = req.params;
  res.send({ userId, postId });
});
```

**Handler return value behavior**

- If your handler **does not call** `res.send()` / `res.json()` / `res.sendFile()` / `res.sendStream()`, but it **returns a value that is not `undefined`**, then the server will treat it as a successful result and automatically send it back to the client (equivalent to `res.send(returnValue)`).
- For **async handlers** (`Promise`): if the promise **resolves to a value that is not `undefined`** and no response has been sent yet, it will also be auto-sent.
- If the handler (or resolved promise) returns `undefined` **and** no response method was called, the server will respond with error code `NO_RESPONSE`.

Examples:

```typescript
// Sync: auto-send return value
server.on('/api/hello', () => {
  return { message: 'hello' };
});

// Async: auto-send resolved value
server.on('/api/user', async (req) => {
  const user = await getUser(req.body.userId);
  return user; // auto-send if not undefined
});

// If you manually send, return value is ignored
server.on('/api/manual', (req, res) => {
  res.send({ ok: true });
  return { ignored: true };
});
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

> Note: React is only required if you use `request-iframe/react`. Installing `request-iframe` alone does not require React.

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
| `STREAM_TIMEOUT` | Stream idle timeout |
| `STREAM_EXPIRED` | Stream expired (writable stream lifetime exceeded) |
| `STREAM_CANCELLED` | Stream cancelled |
| `STREAM_NOT_BOUND` | Stream not bound to request context |
| `STREAM_START_TIMEOUT` | Stream start timeout (request body stream_start not received in time) |
| `TOO_MANY_REQUESTS` | Too many concurrent requests (server-side limit) |

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
