# Quick Start

Get started with request-iframe in 5 minutes - communicate with iframes like sending HTTP requests!

## Installation

```bash
npm install request-iframe
# or
yarn add request-iframe
```

## Scenario

Suppose you have a parent page that needs to communicate with an embedded iframe:

```
┌─────────────────────────────────────────┐
│  Parent Page (parent.html)                │
│  ┌───────────────────────────────────┐  │
│  │  iframe (child.html)               │  │
│  │                                    │  │
│  │  Need to get data from iframe      │  │
│  │                                    │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Step 1: Create Client in Parent Page

```typescript
// parent.html
import { requestIframeClient } from 'request-iframe';

// Get iframe element
const iframe = document.getElementById('my-iframe') as HTMLIFrameElement;

// Create client (for sending requests)
const client = requestIframeClient(iframe, { 
  secretKey: 'my-app'  // Message isolation identifier, must match iframe
});

// Send request and wait for response
async function getUserInfo(userId: number) {
  const response = await client.send('/api/getUserInfo', { userId });
  return response.data;
}

// Use
const user = await getUserInfo(123);
console.log(user); // { name: 'Tom', age: 18 }
```

## Step 2: Create Server in iframe

```typescript
// child.html (inside iframe)
import { requestIframeServer } from 'request-iframe';

// Create server (for receiving requests)
const server = requestIframeServer({ 
  secretKey: 'my-app'  // Must match parent page's client!
});

// Register request handler
server.on('/api/getUserInfo', (req, res) => {
  const { userId } = req.body;
  
  // Simulate fetching user info from database
  const user = { name: 'Tom', age: 18 };
  
  // Return response
  res.send(user);
});
```

**That's it!** 🎉

---

## More Examples

### Async Processing

```typescript
// Server side
server.on('/api/fetchData', async (req, res) => {
  // Async operation (like network request)
  const data = await fetch('https://api.example.com/data').then(r => r.json());
  res.send(data);
});
```

When the handler returns a Promise, the framework automatically:
1. Notifies Client this is an async task
2. Switches timeout from 5 seconds to 120 seconds

### Error Handling

```typescript
// Server side
server.on('/api/getData', (req, res) => {
  if (!req.body.id) {
    return res.status(400).send({ error: 'Missing id parameter' });
  }
  res.send({ data: '...' });
});

// Client side
try {
  const response = await client.send('/api/getData', {});
} catch (error) {
  if (error.response?.status === 400) {
    console.error('Parameter error:', error.response.data.error);
  }
}
```

### Add Authentication

```typescript
// Server side: Add middleware
server.use((req, res, next) => {
  const token = req.headers['authorization'];
  
  if (!token || !isValidToken(token)) {
    return res.status(401).send({ error: 'Unauthorized' });
  }
  
  next(); // Continue execution
});

// Client side: Add request interceptor
client.interceptors.request.use((config) => {
  config.headers = {
    ...config.headers,
    'Authorization': `Bearer ${getToken()}`
  };
  return config;
});
```

### Batch Register Interfaces

```typescript
server.map({
  '/api/users/list': (req, res) => {
    res.send([{ id: 1, name: 'Tom' }, { id: 2, name: 'Jerry' }]);
  },
  '/api/users/create': async (req, res) => {
    const user = await createUser(req.body);
    res.status(201).send(user);
  },
  '/api/users/delete': async (req, res) => {
    await deleteUser(req.body.id);
    res.send({ success: true });
  }
});
```

### File Download

```typescript
// Server side
server.on('/api/download', async (req, res) => {
  const content = 'This is file content';
  await res.sendFile(content, {
    mimeType: 'text/plain',
    fileName: 'example.txt'
  });
});

// Client side
const response = await client.send('/api/download', {});
if (response.fileData) {
  // Create download link
  const blob = new Blob(
    [atob(response.fileData.content)], 
    { type: response.fileData.mimeType }
  );
  const url = URL.createObjectURL(blob);
  
  // Trigger download
  const a = document.createElement('a');
  a.href = url;
  a.download = response.fileData.fileName || 'download';
  a.click();
}
```

### Debug Mode

Enable trace mode to view detailed logs:

```typescript
const client = requestIframeClient(iframe, { 
  secretKey: 'my-app',
  trace: true  // Enable debug logs
});

const server = requestIframeServer({ 
  secretKey: 'my-app',
  trace: true
});
```

Console will output:
```
[request-iframe] [INFO] 📤 Request Start { path: '/api/getData', body: {...} }
[request-iframe] [INFO] 📨 ACK Received { requestId: 'req_xxx' }
[request-iframe] [INFO] ✅ Request Success { status: 200, data: {...} }
```

---

## Common Questions

### Q: Why does the request keep timing out?

Check the following:
1. Is the iframe fully loaded?
2. Do Client and Server have the same `secretKey`?
3. Is the Server handler path correct?

### Q: How to send requests from iframe to parent page?

```typescript
// Inside iframe
const client = requestIframeClient(window.parent, { secretKey: 'reverse' });
await client.send('/notify', { event: 'ready' });

// Parent page
const server = requestIframeServer({ secretKey: 'reverse' });
server.on('/notify', (req, res) => {
  console.log('iframe is ready');
  res.send({ ok: true });
});
```

### Q: Does it support TypeScript?

Fully supported! All APIs have complete type definitions.

```typescript
import { 
  requestIframeClient, 
  requestIframeServer,
  Response,
  ServerRequest,
  ServerResponse 
} from 'request-iframe';

// Generic support
interface User {
  id: number;
  name: string;
}

const response = await client.send<User>('/api/user', { id: 1 });
console.log(response.data.name); // TypeScript knows this is string
```

---

## Next Steps

- View [README.md](./README.md) for complete API documentation (English)
- View [README.CN.md](./README.CN.md) for complete API documentation (中文)
- Check [src/__tests__](./src/__tests__) directory for more examples from test cases
