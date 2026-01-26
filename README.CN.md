# request-iframe

像发送 HTTP 请求一样与 iframe 通信！基于 `postMessage` 实现的 iframe 跨域通信库。

> 🌐 **Languages**: [English](./README.md) | [中文](./README.CN.md)

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-Ready-blue" alt="TypeScript Ready">
  <img src="https://img.shields.io/badge/API-Express%20Like-green" alt="Express Like API">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License">
  <img src="https://img.shields.io/badge/Test%20Coverage-76%25-brightgreen" alt="Test Coverage">
</p>

## 📑 目录

- [为什么选择 request-iframe？](#为什么选择-request-iframe)
- [特性](#特性)
- [安装](#安装)
- [快速开始](#快速开始)
- [使用场景](#使用场景)
- [实现原理](#实现原理)
  - [通信协议](#通信协议)
  - [消息类型](#消息类型)
  - [超时机制](#超时机制)
  - [协议版本](#协议版本)
- [详细功能](#详细功能)
  - [拦截器](#拦截器)
  - [中间件](#中间件)
  - [Headers 和 Cookies](#headers-和-cookies)
  - [文件传输](#文件传输)
  - [流式传输（Stream）](#流式传输stream)
  - [连接检测](#连接检测)
  - [响应确认](#响应确认)
  - [追踪模式](#追踪模式)
  - [多语言支持](#多语言支持)
- [API 参考](#api-参考)
- [错误处理](#错误处理)
- [FAQ](#faq)
- [开发](#开发)
- [许可证](#许可证)

## 为什么选择 request-iframe？

在微前端、iframe 嵌套等场景下，父子页面通信是常见需求。传统的 `postMessage` 通信存在以下痛点：

| 痛点 | 传统方式 | request-iframe |
|------|----------|----------------|
| 请求-响应关联 | 手动维护 requestId | 自动管理，Promise 风格 |
| 超时处理 | 手动实现定时器 | 内置多阶段超时机制 |
| 错误处理 | 各种边界情况 | 标准化错误码 |
| 消息隔离 | 容易串线 | secretKey 自动隔离 |
| API 风格 | 事件监听式 | 类 HTTP 请求/Express 风格 |
| TypeScript | 需要自定义类型 | 完整类型支持 |
| 测试覆盖 | 无 | 76%+ 测试覆盖率 |

**核心优势**：
- ✅ **零学习成本** - 如果你熟悉 axios 和 Express，立即上手
- ✅ **类型安全** - 完整的 TypeScript 支持，开发体验友好
- ✅ **生产就绪** - 高测试覆盖率，经过充分测试
- ✅ **功能丰富** - 拦截器、中间件、流式传输、文件传输一应俱全

## 特性

- 🚀 **类 HTTP 风格** - Client 发送请求，Server 处理并响应，就像 axios + express
- 🔌 **拦截器支持** - 请求/响应拦截器，轻松实现统一鉴权、日志等
- 🎭 **中间件机制** - Express 风格的中间件，支持路径匹配
- ⏱️ **智能超时** - 三阶段超时（连接/同步/异步），自动识别长任务
- 📦 **TypeScript** - 完整的类型定义和智能提示
- 🔒 **消息隔离** - secretKey 机制避免多实例消息串线
- 📁 **文件传输** - 支持 base64 编码的文件发送
- 🌊 **流式传输** - 支持大文件分块传输，支持异步迭代器
- 🌍 **多语言** - 错误消息可自定义，便于国际化
- ✅ **协议版本** - 内置版本控制，便于升级兼容

## 安装

```bash
npm install request-iframe
# 或
yarn add request-iframe
# 或
pnpm add request-iframe
```

**版本要求**: Node.js >= 14

**TypeScript**: 内置完整类型定义，无需安装 `@types/request-iframe`

## 快速开始

### 1. 父页面（Client 端）

```typescript
import { requestIframeClient } from 'request-iframe';

// 获取 iframe 元素
const iframe = document.querySelector('iframe')!;

// 创建 client
const client = requestIframeClient(iframe, { secretKey: 'my-app' });

// 发送请求（就像 axios）
const response = await client.send('/api/getUserInfo', { userId: 123 });
console.log(response.data); // { name: 'Tom', age: 18 }
```

### 2. iframe 内页面（Server 端）

```typescript
import { requestIframeServer } from 'request-iframe';

// 创建 server
const server = requestIframeServer({ secretKey: 'my-app' });

// 注册处理器（就像 express）
server.on('/api/getUserInfo', (req, res) => {
  const { userId } = req.body;
  res.send({ name: 'Tom', age: 18 });
});
```

就这么简单！🎉

> 💡 **提示**: 更多快速上手指南请查看 [QUICKSTART.CN.md](./QUICKSTART.CN.md) 或 [QUICKSTART.md](./QUICKSTART.md) (English)

---

## 实现原理

### 通信协议

request-iframe 在 `postMessage` 基础上实现了一套类 HTTP 的通信协议：

```
  Client (父页面)                              Server (iframe)
       │                                            │
       │  ──── REQUEST ──────────────────────────>  │  发送请求
       │                                            │
       │  <──── ACK ─────────────────────────────  │  确认收到
       │                                            │
       │                                            │  执行 handler
       │                                            │
       │  <──── ASYNC (可选) ────────────────────  │  若 handler 返回 Promise
       │                                            │
       │  <──── RESPONSE ────────────────────────  │  返回结果
       │                                            │
       │  ──── RECEIVED (可选) ──────────────────>  │  确认收到响应
       │                                            │
```

### 消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| `request` | Client → Server | 客户端发起请求 |
| `ack` | Server → Client | 服务端确认收到请求 |
| `async` | Server → Client | 通知客户端这是异步任务（handler 返回 Promise 时发送） |
| `response` | Server → Client | 返回响应数据 |
| `error` | Server → Client | 返回错误信息 |
| `received` | Client → Server | 客户端确认收到响应（可选，由 `requireAck` 控制） |
| `ping` | Client → Server | 连接检测（`isConnect()` 方法） |
| `pong` | Server → Client | 连接检测响应 |

### 超时机制

request-iframe 采用三阶段超时策略，智能适应不同场景：

```typescript
client.send('/api/getData', data, {
  ackTimeout: 500,        // 阶段1：等待 ACK 的超时时间（默认 500ms）
  timeout: 5000,          // 阶段2：请求超时时间（默认 5s）
  asyncTimeout: 120000    // 阶段3：异步请求超时时间（默认 120s）
});
```

**超时切换流程：**

```
发送 REQUEST
    │
    ▼
┌───────────────────┐    超时    ┌─────────────────────────────┐
│ ackTimeout        │ ────────> │ 错误: ACK_TIMEOUT           │
│ (等待 ACK)         │           │ "连接失败，Server 未响应"    │
└───────────────────┘           └─────────────────────────────┘
    │
    │ 收到 ACK
    ▼
┌───────────────────┐    超时    ┌─────────────────────────────┐
│ timeout           │ ────────> │ 错误: TIMEOUT               │
│ (等待 RESPONSE)    │           │ "请求超时"                   │
└───────────────────┘           └─────────────────────────────┘
    │
    │ 收到 ASYNC（可选）
    ▼
┌───────────────────┐    超时    ┌─────────────────────────────┐
│ asyncTimeout      │ ────────> │ 错误: ASYNC_TIMEOUT         │
│ (等待 RESPONSE)    │           │ "异步请求超时"               │
└───────────────────┘           └─────────────────────────────┘
    │
    │ 收到 RESPONSE
    ▼
  请求完成 ✓
```

**为什么这样设计？**

| 阶段 | 超时时间 | 场景 |
|------|----------|------|
| ackTimeout | 较短（500ms） | 快速检测 Server 是否在线，避免长时间等待不可达的 iframe |
| timeout | 中等（5s） | 适用于简单的同步处理，如读取数据、参数校验等 |
| asyncTimeout | 较长（120s） | 适用于复杂异步操作，如文件处理、批量操作、第三方 API 调用等 |

### 协议版本

每条消息都包含 `__requestIframe__` 字段标识协议版本，以及 `timestamp` 字段记录消息创建时间：

```typescript
{
  __requestIframe__: 1,  // 协议版本号
  timestamp: 1704067200000,  // 消息创建时间戳（毫秒）
  type: 'request',
  requestId: 'req_xxx',
  path: '/api/getData',
  body: { ... }
}
```

这使得：
- 不同版本的库可以做兼容处理
- 新版本 Server 可兼容旧版本 Client
- 版本过低时会返回明确的错误信息
- `timestamp` 便于调试消息延迟、分析通信性能

---

## 使用场景

### 微前端通信

在微前端架构中，主应用需要与子应用 iframe 进行数据交互：

```typescript
// 主应用（父页面）
const client = requestIframeClient(iframe, { secretKey: 'main-app' });

// 获取子应用的用户信息
const userInfo = await client.send('/api/user/info', {});

// 通知子应用更新数据
await client.send('/api/data/refresh', { timestamp: Date.now() });
```

### 第三方组件集成

集成第三方组件时，通过 iframe 隔离，同时保持通信：

```typescript
// 父页面
const client = requestIframeClient(thirdPartyIframe, { secretKey: 'widget' });

// 配置组件
await client.send('/config', {
  theme: 'dark',
  language: 'zh-CN'
});

// 监听组件事件（通过反向通信）
const server = requestIframeServer({ secretKey: 'widget-events' });
server.on('/event', (req, res) => {
  console.log('组件事件:', req.body);
  res.send({ received: true });
});
```

### 跨域数据获取

当 iframe 与父页面不同域时，使用 request-iframe 安全地获取数据：

```typescript
// iframe 内（不同域）
const server = requestIframeServer({ secretKey: 'data-api' });

server.on('/api/data', async (req, res) => {
  // 从同域 API 获取数据（iframe 可以访问同域资源）
  const data = await fetch('/api/internal/data').then(r => r.json());
  res.send(data);
});

// 父页面（跨域）
const client = requestIframeClient(iframe, { secretKey: 'data-api' });
const data = await client.send('/api/data', {}); // 成功获取跨域数据
```

### 文件预览和下载

在 iframe 中处理文件，然后传输给父页面：

```typescript
// iframe 内：处理文件并返回
server.on('/api/processFile', async (req, res) => {
  const { fileId } = req.body;
  const processedFile = await processFile(fileId);
  
  // 返回处理后的文件
  await res.sendFile(processedFile, {
    mimeType: 'application/pdf',
    fileName: `processed-${fileId}.pdf`
  });
});

// 父页面：下载文件
const response = await client.send('/api/processFile', { fileId: '123' });
if (response.fileData) {
  downloadFile(response.fileData);
}
```

---

## 详细功能

### 拦截器

#### 请求拦截器

```typescript
// 添加请求拦截器（统一添加 token）
client.interceptors.request.use((config) => {
  config.headers = {
    ...config.headers,
    'Authorization': `Bearer ${getToken()}`
  };
  return config;
});

// 错误处理
client.interceptors.request.use(
  (config) => config,
  (error) => {
    console.error('请求配置错误:', error);
    return Promise.reject(error);
  }
);
```

#### 响应拦截器

```typescript
// 添加响应拦截器（统一数据转换）
client.interceptors.response.use((response) => {
  // 假设后端返回 { code: 0, data: {...} } 格式
  if (response.data.code === 0) {
    response.data = response.data.data;
  }
  return response;
});

// 错误处理
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'TIMEOUT') {
      message.error('请求超时，请重试');
    }
    return Promise.reject(error);
  }
);
```

### 中间件

Server 端支持 Express 风格的中间件：

#### 全局中间件

```typescript
// 日志中间件
server.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.path}`, req.body);
  next();
});

// 权限校验中间件
server.use((req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) {
    return res.status(401).send({ error: 'Unauthorized' });
  }
  // 验证 token...
  next();
});
```

#### 路径匹配中间件

```typescript
// 只对 /api/* 路径生效
server.use('/api/*', (req, res, next) => {
  console.log('API 请求:', req.path);
  next();
});

// 正则匹配
server.use(/^\/admin\//, (req, res, next) => {
  // 管理员接口的特殊处理
  next();
});

// 数组匹配
server.use(['/user', '/profile'], (req, res, next) => {
  // 用户相关接口
  next();
});
```

### Headers 和 Cookies

> **注意**：这里的 `headers` 和 `cookies` 并非浏览器真实的 HTTP Headers 和 Cookies，而是 request-iframe 模拟 HTTP 风格实现的**消息元数据传递机制**。数据通过 `postMessage` 在 iframe 间传递，不会影响浏览器的真实 Cookie 存储。

**为什么这样设计？**

| 设计目的 | 说明 |
|----------|------|
| **API 风格一致** | 与 HTTP 请求（axios/fetch）和服务端（Express）保持一致的使用方式 |
| **降低学习成本** | 熟悉 HTTP 开发的用户可以快速上手，无需学习新的 API |
| **三方库兼容** | 便于复用或适配 Express 中间件、认证库等，只需少量修改 |
| **跨 iframe 状态共享** | 实现不同 iframe 间的登录态传递、权限校验等，解决 iframe 隔离带来的状态同步问题 |
| **灵活的数据传递** | 在 body 之外提供额外的元数据通道，便于分层处理（如中间件读取 headers，业务逻辑读取 body） |

#### Cookies 自动管理

request-iframe 模拟了 HTTP 的 cookie 自动管理机制：

```
┌─────────────────────────────────────────────────────────────────┐
│                     Cookies 自动管理流程                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client                                 Server                  │
│    │                                       │                    │
│    │  ── REQUEST (自动携带路径匹配的 cookies)  │                    │
│    │     cookies: { token: 'abc' }         │                    │
│    │                                       │                    │
│    │  <── RESPONSE ─────────────────────  │                    │
│    │     headers: {                        │  res.cookie(...)   │
│    │       'Set-Cookie': [                 │                    │
│    │         'token=xyz; Path=/api',       │                    │
│    │         'global=123; Path=/'          │                    │
│    │       ]                               │                    │
│    │     }                                 │                    │
│    │                                       │                    │
│    │  【Client 解析 Set-Cookie 并保存】      │                    │
│    │                                       │                    │
│    │  ── 后续请求 /api/xxx ──────────────>  │                    │
│    │     cookies: { token: 'xyz',          │  路径匹配的 cookies  │
│    │                global: '123' }        │                    │
│    │                                       │                    │
└─────────────────────────────────────────────────────────────────┘
```

**工作机制（类似 HTTP Set-Cookie）：**

1. **Server 设置 cookie 时**：通过 `res.cookie(name, value, options)` 生成 `Set-Cookie` 字符串
2. **响应返回时**：所有 `Set-Cookie` 存放在 `headers['Set-Cookie']` 数组中
3. **Client 收到响应后**：解析 `Set-Cookie` header，根据 Path 等属性保存到 Cookie 存储
4. **Client 发送请求时**：只携带**路径匹配**的 cookies（类似浏览器行为）

```typescript
// Server 端：登录时设置 token（支持完整的 Cookie 选项）
server.on('/api/login', (req, res) => {
  const { username, password } = req.body;
  // 验证用户...
  
  // 设置 cookie（支持 path、expires、maxAge、httpOnly 等选项）
  res.cookie('authToken', 'jwt_xxx', { path: '/api', httpOnly: true });
  res.cookie('userId', '12345', { path: '/' });
  res.send({ success: true });
});

// Server 端：后续接口读取 token（客户端自动携带路径匹配的 cookies）
server.on('/api/getUserInfo', (req, res) => {
  const token = req.cookies['authToken'];  // 路径匹配，自动携带
  const userId = req.cookies['userId'];     // 根路径的 cookie，所有请求都携带
  // 验证 token...
  res.send({ name: 'Tom', age: 18 });
});

// Server 端：清除 cookie
server.on('/api/logout', (req, res) => {
  res.clearCookie('authToken', { path: '/api' });
  res.send({ success: true });
});
```

```typescript
// Client 端：登录
await client.send('/api/login', { username: 'tom', password: '123' });

// Client 端：后续请求 /api/getUserInfo（自动携带 authToken 和 userId）
const userInfo = await client.send('/api/getUserInfo', {});

// Client 端：请求根路径（只携带 userId，因为 authToken 的 path 是 /api）
const rootData = await client.send('/other', {});
```

#### Client Cookie 管理 API

Client 提供了手动管理 cookies 的 API，支持**路径隔离**：

```typescript
// 获取所有 cookies
client.getCookies();  // { authToken: 'jwt_xxx', userId: '12345' }

// 获取匹配指定路径的 cookies
client.getCookies('/api');  // 只返回路径匹配 /api 的 cookies

// 获取指定 cookie
client.getCookie('authToken');  // 'jwt_xxx'
client.getCookie('authToken', '/api');  // 指定路径获取

// 手动设置 cookie（支持路径选项）
client.setCookie('theme', 'dark');  // 默认路径 '/'
client.setCookie('apiConfig', 'v2', { path: '/api' });  // 指定路径
client.setCookie('temp', 'xxx', { maxAge: 3600 });  // 1 小时后过期

// 删除指定 cookie
client.removeCookie('theme');  // 删除路径为 '/' 的 theme
client.removeCookie('apiConfig', '/api');  // 删除指定路径的 cookie

// 清除所有 cookies（如登出时）
client.clearCookies();
```

#### Headers 使用示例

```typescript
// Client 端发送自定义 headers
const response = await client.send('/api/data', {}, {
  headers: {
    'X-Device-Id': 'device-123',
    'X-Platform': 'web',
    'Authorization': 'Bearer xxx'  // 也可以通过 headers 传递 token
  }
});

// Server 端读取和设置 headers
server.on('/api/data', (req, res) => {
  // 读取请求 headers
  const deviceId = req.headers['x-device-id'];
  const platform = req.headers['x-platform'];
  
  // 设置响应 headers
  res.setHeader('X-Request-Id', req.requestId);
  res.set('X-Custom-Header', 'value');  // 链式调用
  
  res.send({ data: 'ok' });
});
```

### 文件传输

```typescript
// Server 端发送文件
server.on('/api/download', async (req, res) => {
  // 字符串内容
  await res.sendFile('Hello, World!', {
    mimeType: 'text/plain',
    fileName: 'hello.txt'
  });
  
  // 或者 Blob/File 对象
  const blob = new Blob(['binary data'], { type: 'application/octet-stream' });
  await res.sendFile(blob, { fileName: 'data.bin' });
});

// Client 端接收
const response = await client.send('/api/download', {});
if (response.fileData) {
  const { content, mimeType, fileName } = response.fileData;
  
  // content 是 base64 编码的字符串
  const binaryString = atob(content);
  const blob = new Blob([binaryString], { type: mimeType });
  
  // 下载文件
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'download';
  a.click();
}
```

### 流式传输（Stream）

对于大文件或需要分块传输的场景，可以使用流式传输：

```typescript
import { 
  IframeWritableStream, 
  IframeFileWritableStream,
  isIframeReadableStream,
  isIframeFileStream 
} from 'request-iframe';

// Server 端：使用迭代器发送数据流
server.on('/api/stream', async (req, res) => {
  const stream = new IframeWritableStream({
    type: 'data',
    chunked: true,
    // 使用异步迭代器生成数据
    iterator: async function* () {
      for (let i = 0; i < 10; i++) {
        yield { chunk: i, data: `Data chunk ${i}` };
        await new Promise(r => setTimeout(r, 100)); // 模拟延迟
      }
    }
  });
  
  await res.sendStream(stream);
});

// Server 端：使用 next 函数发送数据流
server.on('/api/stream2', async (req, res) => {
  let count = 0;
  const stream = new IframeWritableStream({
    next: async () => {
      if (count >= 5) {
        return { data: `Final chunk`, done: true };
      }
      return { data: `Chunk ${count++}`, done: false };
    }
  });
  
  await res.sendStream(stream);
});

// Server 端：发送文件流
server.on('/api/fileStream', async (req, res) => {
  const fileData = new Uint8Array([/* 文件内容 */]);
  const stream = new IframeFileWritableStream({
    filename: 'large-file.bin',
    mimeType: 'application/octet-stream',
    size: fileData.length,
    chunked: true,
    iterator: async function* () {
      const chunkSize = 1024;
      for (let i = 0; i < fileData.length; i += chunkSize) {
        yield fileData.slice(i, i + chunkSize);
      }
    }
  });
  
  await res.sendStream(stream);
});

// Client 端：接收流数据
const response = await client.send('/api/stream', {});

// 判断是否是流响应
if (isIframeReadableStream(response.stream)) {
  // 方式1：一次性读取所有数据
  const allData = await response.stream.read();
  
  // 方式2：使用异步迭代器逐块读取
  for await (const chunk of response.stream) {
    console.log('Received chunk:', chunk);
  }
  
  // 监听流结束
  response.stream.onEnd(() => {
    console.log('Stream ended');
  });
  
  // 监听流错误
  response.stream.onError((error) => {
    console.error('Stream error:', error);
  });
  
  // 取消流
  response.stream.cancel('User cancelled');
}

// Client 端：接收文件流
const fileResponse = await client.send('/api/fileStream', {});

if (isIframeFileStream(fileResponse.stream)) {
  // 读取为 Blob
  const blob = await fileResponse.stream.readAsBlob();
  
  // 读取为 ArrayBuffer
  const buffer = await fileResponse.stream.readAsArrayBuffer();
  
  // 读取为 Data URL
  const dataUrl = await fileResponse.stream.readAsDataURL();
  
  // 获取文件信息
  console.log('Filename:', fileResponse.stream.filename);
  console.log('MIME type:', fileResponse.stream.mimeType);
  console.log('Size:', fileResponse.stream.size);
}
```

**流类型说明：**

| 类型 | 说明 |
|------|------|
| `IframeWritableStream` | 服务端可写流，用于发送普通数据 |
| `IframeFileWritableStream` | 服务端文件可写流，自动处理 base64 编码 |
| `IframeReadableStream` | 客户端可读流，用于接收普通数据 |
| `IframeFileReadableStream` | 客户端文件可读流，自动处理 base64 解码 |

**流选项：**

```typescript
interface WritableStreamOptions {
  type?: 'data' | 'file';    // 流类型
  chunked?: boolean;          // 是否分块传输（默认 true）
  iterator?: () => AsyncGenerator;  // 数据生成迭代器
  next?: () => Promise<{ data: any; done: boolean }>;  // 数据生成函数
  metadata?: Record<string, any>;   // 自定义元数据
}
```

### 连接检测

```typescript
// 检测 Server 是否可达
const isConnected = await client.isConnect();
if (isConnected) {
  console.log('连接正常');
} else {
  console.log('连接失败');
}
```

### 响应确认

Server 可以要求 Client 确认收到响应：

```typescript
server.on('/api/important', async (req, res) => {
  // requireAck: true 表示需要客户端确认
  const received = await res.send(data, { requireAck: true });
  
  if (received) {
    console.log('客户端已确认收到');
  } else {
    console.log('客户端未确认（超时）');
  }
});
```

### 追踪模式

开启追踪模式可以在控制台查看详细的通信日志：

```typescript
const client = requestIframeClient(iframe, { 
  secretKey: 'demo',
  trace: true 
});

const server = requestIframeServer({ 
  secretKey: 'demo',
  trace: true 
});

// 控制台输出：
// [request-iframe] [INFO] 📤 Request Start { path: '/api/getData', ... }
// [request-iframe] [INFO] 📨 ACK Received { requestId: '...' }
// [request-iframe] [INFO] ✅ Request Success { status: 200, data: {...} }
```

### 多语言支持

```typescript
import { setMessages } from 'request-iframe';

// 切换到中文
setMessages({
  ACK_TIMEOUT: 'ACK 确认超时，已等待 {0} 毫秒',
  REQUEST_TIMEOUT: '请求超时，已等待 {0} 毫秒',
  REQUEST_FAILED: '请求失败',
  METHOD_NOT_FOUND: '方法未找到',
  MIDDLEWARE_ERROR: '中间件错误',
  IFRAME_NOT_READY: 'iframe 尚未就绪'
});
```

---

## API 参考

### requestIframeClient(target, options?)

创建 Client 实例。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `target` | `HTMLIFrameElement \| Window` | 目标 iframe 元素或 window 对象 |
| `options.secretKey` | `string` | 消息隔离标识（可选） |
| `options.trace` | `boolean` | 是否开启追踪模式（可选） |
| `options.ackTimeout` | `number` | 全局默认 ACK 确认超时（ms），默认 500 |
| `options.timeout` | `number` | 全局默认请求超时（ms），默认 5000 |
| `options.asyncTimeout` | `number` | 全局默认异步超时（ms），默认 120000 |

**返回值：** `RequestIframeClient`

**示例：**

```typescript
// 设置全局超时配置
const client = requestIframeClient(iframe, {
  secretKey: 'my-app',
  ackTimeout: 1000,       // ACK 确认超时 1s
  timeout: 10000,         // 请求超时 10s
  asyncTimeout: 300000    // 异步超时 5min
});

// 单次请求可以覆盖全局配置
await client.send('/api/longTask', {}, {
  asyncTimeout: 600000  // 这个请求使用 10min 超时
});
```

### requestIframeServer(options?)

创建 Server 实例。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `options.secretKey` | `string` | 消息隔离标识（可选） |
| `options.trace` | `boolean` | 是否开启追踪模式（可选） |
| `options.ackTimeout` | `number` | 等待客户端确认超时（ms），默认 5000 |

**返回值：** `RequestIframeServer`

### Client API

#### client.send(path, body?, options?)

发送请求。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | `string` | 请求路径 |
| `body` | `object` | 请求数据（可选） |
| `options.ackTimeout` | `number` | ACK 确认超时（ms），默认 500 |
| `options.timeout` | `number` | 请求超时（ms），默认 5000 |
| `options.asyncTimeout` | `number` | 异步超时（ms），默认 120000 |
| `options.headers` | `object` | 请求 headers（可选） |
| `options.cookies` | `object` | 请求 cookies（可选，会与内部存储的 cookies 合并，传入的优先级更高） |
| `options.requestId` | `string` | 自定义请求 ID（可选） |

**返回值：** `Promise<Response>`

```typescript
interface Response<T = any> {
  data: T;                    // 响应数据
  status: number;             // 状态码
  statusText: string;         // 状态文本
  requestId: string;          // 请求 ID
  headers?: Record<string, string | string[]>;  // 响应 headers（Set-Cookie 为数组）
  fileData?: {                // 文件数据（如果有）
    content: string;          // base64 编码内容
    mimeType?: string;
    fileName?: string;
  };
  stream?: IIframeReadableStream<T>;  // 流响应（如果有）
}
```

#### client.isConnect()

检测 Server 是否可达。

**返回值：** `Promise<boolean>`

#### client.interceptors

拦截器管理器。

```typescript
// 请求拦截器
client.interceptors.request.use(onFulfilled, onRejected?);

// 响应拦截器
client.interceptors.response.use(onFulfilled, onRejected?);
```

#### client.getCookies(path?)

获取 cookies。

**参数：** `path?: string` - 请求路径（可选，不传返回所有 cookies）

**返回值：** `Record<string, string>` - 匹配路径的 cookies

#### client.getCookie(name, path?)

获取指定 cookie。

**参数：** 
- `name: string` - cookie 名称
- `path?: string` - 路径（可选）

**返回值：** `string | undefined`

#### client.setCookie(name, value, options?)

设置 cookie。

**参数：**
- `name: string` - cookie 名称
- `value: string` - cookie 值
- `options?: { path?: string; expires?: Date; maxAge?: number }` - cookie 选项

#### client.removeCookie(name, path?)

删除指定 cookie。

**参数：** `name: string` - cookie 名称

#### client.clearCookies()

清除所有 cookies。

### Server API

#### server.on(path, handler)

注册路由处理器。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | `string` | 请求路径 |
| `handler` | `ServerHandler` | 处理函数 |

```typescript
type ServerHandler = (req: ServerRequest, res: ServerResponse) => any | Promise<any>;
```

#### server.off(path)

移除路由处理器。

#### server.map(handlers)

批量注册处理器。

```typescript
server.map({
  '/api/users': (req, res) => res.send([...]),
  '/api/posts': (req, res) => res.send([...])
});
```

#### server.use(middleware)
#### server.use(path, middleware)

注册中间件。

```typescript
// 全局中间件
server.use((req, res, next) => { ... });

// 路径匹配中间件
server.use('/api/*', (req, res, next) => { ... });
server.use(/^\/admin/, (req, res, next) => { ... });
server.use(['/a', '/b'], (req, res, next) => { ... });
```

#### server.destroy()

销毁 Server 实例，移除所有监听器。

### ServerRequest 对象

```typescript
interface ServerRequest {
  body: any;                          // 请求 body
  headers: Record<string, string>;    // 请求 headers
  cookies: Record<string, string>;    // 请求 cookies
  path: string;                       // 请求路径
  requestId: string;                  // 请求 ID
  origin: string;                     // 来源 origin
  source: Window;                     // 来源 window
  res: ServerResponse;                // 关联的 Response 对象
}
```

### ServerResponse 对象

```typescript
interface ServerResponse {
  // 发送响应
  send(data: any, options?: { requireAck?: boolean }): Promise<boolean>;
  json(data: any, options?: { requireAck?: boolean }): Promise<boolean>;
  
  // 发送文件
  sendFile(content: string | Blob | File, options?: {
    mimeType?: string;
    fileName?: string;
    requireAck?: boolean;
  }): Promise<boolean>;
  
  // 发送流
  sendStream(stream: IframeWritableStream): Promise<void>;
  
  // 设置状态码（链式调用）
  status(code: number): ServerResponse;
  
  // 设置 header
  setHeader(name: string, value: string | number | string[]): void;
  set(name: string, value: string | number | string[]): ServerResponse;
  
  // 设置 cookie（生成 Set-Cookie header）
  cookie(name: string, value: string, options?: CookieOptions): ServerResponse;
  clearCookie(name: string, options?: CookieOptions): ServerResponse;
  
  // 属性
  statusCode: number;
  headers: Record<string, string | string[]>;  // Set-Cookie 为数组
}

interface CookieOptions {
  path?: string;        // Cookie 路径，默认 '/'
  expires?: Date;       // 过期时间
  maxAge?: number;      // 最大存活时间（秒）
  httpOnly?: boolean;   // HttpOnly 标记
  secure?: boolean;     // Secure 标记
  sameSite?: 'Strict' | 'Lax' | 'None';  // SameSite 属性
}
```

### 常量导出

```typescript
import { 
  // HTTP 状态码
  HttpStatus,
  HttpStatusText,
  getStatusText,
  
  // 错误码
  ErrorCode,
  
  // 消息类型
  MessageType,
  
  // 默认超时配置
  DefaultTimeout,
  
  // 协议版本
  ProtocolVersion,
  
  // 多语言消息
  Messages,
  setMessages,
  formatMessage
} from 'request-iframe';
```

---

## 错误处理

### 错误码

| 错误码 | 说明 |
|--------|------|
| `ACK_TIMEOUT` | ACK 确认超时（未收到 ACK） |
| `TIMEOUT` | 同步请求超时 |
| `ASYNC_TIMEOUT` | 异步请求超时 |
| `REQUEST_ERROR` | 请求处理错误 |
| `METHOD_NOT_FOUND` | 未找到对应的处理器 |
| `NO_RESPONSE` | 处理器未发送响应 |
| `PROTOCOL_UNSUPPORTED` | 协议版本不支持 |
| `IFRAME_NOT_READY` | iframe 未就绪 |
| `STREAM_ERROR` | 流传输错误 |
| `STREAM_CANCELLED` | 流被取消 |
| `STREAM_NOT_BOUND` | 流未绑定到请求上下文 |

### 错误处理示例

```typescript
try {
  const response = await client.send('/api/getData', { id: 1 });
} catch (error) {
  switch (error.code) {
    case 'ACK_TIMEOUT':
      console.error('无法连接到 iframe');
      break;
    case 'TIMEOUT':
      console.error('请求超时');
      break;
    case 'METHOD_NOT_FOUND':
      console.error('接口不存在');
      break;
    default:
      console.error('请求失败:', error.message);
  }
}
```

---

## FAQ

### 1. secretKey 有什么用？

`secretKey` 用于消息隔离。当页面中有多个 iframe 或多个 request-iframe 实例时，通过不同的 `secretKey` 可以避免消息串线：

```typescript
// iframe A 的通信
const clientA = requestIframeClient(iframeA, { secretKey: 'app-a' });
const serverA = requestIframeServer({ secretKey: 'app-a' });

// iframe B 的通信
const clientB = requestIframeClient(iframeB, { secretKey: 'app-b' });
const serverB = requestIframeServer({ secretKey: 'app-b' });
```

### 2. 为什么需要 ACK 确认？

ACK 机制类似 TCP 握手，用于：
1. 快速确认 Server 是否在线
2. 区分"连接失败"和"请求超时"
3. 支持异步任务的超时切换

### 3. 如何处理 iframe 跨域？

`postMessage` 本身支持跨域通信，request-iframe 会自动处理：

```typescript
// 父页面 (https://parent.com)
const client = requestIframeClient(iframe);

// iframe 内 (https://child.com)
const server = requestIframeServer();
```

只需确保双方使用相同的 `secretKey`。

### 4. Server 可以主动推送消息吗？

request-iframe 是请求-响应模式，Server 不能主动推送。如需双向通信，可以让 iframe 内也创建 Client：

```typescript
// iframe 内
const server = requestIframeServer({ secretKey: 'my-app' });
const client = requestIframeClient(window.parent, { secretKey: 'my-app-reverse' });

// 主动向父页面发送消息
await client.send('/notify', { event: 'data-changed' });
```

### 5. 如何调试通信问题？

1. **开启 trace 模式**：查看详细的通信日志
2. **检查 secretKey**：确保 Client 和 Server 使用相同的 secretKey
3. **检查 iframe 加载**：确保 iframe 已完全加载
4. **检查控制台**：查看是否有跨域错误

### 6. 支持哪些浏览器？

支持所有现代浏览器，详见 [浏览器兼容性](#浏览器兼容性) 部分。

### 7. 如何处理大文件传输？

对于大文件（>10MB），建议使用流式传输（Stream）功能，可以分块传输，避免内存占用过大：

```typescript
// Server 端：使用流式传输大文件
server.on('/api/largeFile', async (req, res) => {
  const stream = new IframeFileWritableStream({
    filename: 'large-file.zip',
    mimeType: 'application/zip',
    chunked: true,
    iterator: async function* () {
      // 分块读取文件
      const chunkSize = 1024 * 1024; // 1MB per chunk
      for (let i = 0; i < fileSize; i += chunkSize) {
        yield await readFileChunk(i, chunkSize);
      }
    }
  });
  await res.sendStream(stream);
});
```

### 8. 如何实现请求重试？

可以通过响应拦截器实现请求重试：

```typescript
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.code === 'TIMEOUT' || error.code === 'ACK_TIMEOUT') {
      // 重试逻辑
      const maxRetries = 3;
      for (let i = 0; i < maxRetries; i++) {
        try {
          return await client.send(error.config.path, error.config.body, error.config);
        } catch (retryError) {
          if (i === maxRetries - 1) throw retryError;
          await new Promise(r => setTimeout(r, 1000 * (i + 1))); // 递增延迟
        }
      }
    }
    return Promise.reject(error);
  }
);
```

### 9. 如何调试通信问题？

1. **开启 trace 模式**：在创建 client/server 时设置 `trace: true`
2. **检查控制台**：查看详细的通信日志
3. **验证 secretKey**：确保 client 和 server 使用相同的 secretKey
4. **检查 iframe 加载**：确保 iframe 已完全加载后再发送请求
5. **使用 `isConnect()`**：先检测连接是否正常

```typescript
// 开启调试模式
const client = requestIframeClient(iframe, { 
  secretKey: 'my-app',
  trace: true  // 开启详细日志
});

// 检测连接
const connected = await client.isConnect();
if (!connected) {
  console.error('无法连接到 iframe');
}
```

### 10. 性能如何？

- **轻量级**: 核心代码体积小，无外部依赖（除 core-js polyfill）
- **高效**: 使用 Promise 和事件机制，避免轮询
- **内存友好**: 请求完成后自动清理，支持流式传输处理大文件
- **并发支持**: 支持多个并发请求，每个请求独立管理

---

## 开发

### 环境要求

- Node.js >= 14
- npm >= 6 或 yarn >= 1.22

### 开发命令

```bash
# 安装依赖
npm install
# 或
yarn install

# 运行测试
npm test
# 或
yarn test

# 运行测试（监听模式）
npm run test:watch
# 或
yarn test:watch

# 生成测试覆盖率报告
npm run test:coverage
# 或
yarn test:coverage

# 代码检查
npm run lint
# 或
yarn lint

# 自动修复代码问题
npm run lint:fix
# 或
yarn lint:fix

# 构建项目
npm run build
# 或
yarn build
```

### 测试覆盖率

项目当前测试覆盖率达到 **76.88%**，满足生产环境要求：

- **语句覆盖率**: 76.88%
- **分支覆盖率**: 64.13%
- **函数覆盖率**: 75%
- **行覆盖率**: 78.71%

覆盖率报告生成在 `coverage/` 目录下，可以通过 `coverage/index.html` 查看详细的覆盖率报告。

### 项目结构

```
request-iframe/
├── src/
│   ├── api/              # 对外 API（client.ts, server.ts）
│   ├── core/             # 核心实现（client, server, request, response）
│   ├── message/          # 消息通信层（channel, dispatcher）
│   ├── stream/           # 流式传输实现
│   ├── interceptors/    # 拦截器实现
│   ├── utils/            # 工具函数
│   ├── constants/        # 常量定义
│   ├── types/            # TypeScript 类型定义
│   └── __tests__/        # 测试文件
├── library/              # 构建输出
├── coverage/             # 测试覆盖率报告
├── jest.config.js        # Jest 配置
├── tsconfig.json         # TypeScript 配置
└── package.json
```

### 贡献指南

欢迎贡献代码！在提交 PR 之前，请确保：

1. 代码通过 ESLint 检查（`npm run lint`）
2. 所有测试通过（`npm test`）
3. 测试覆盖率不低于 70%
4. 添加必要的测试用例
5. 更新相关文档

### 性能说明

- **消息大小限制**: `postMessage` 本身没有严格的大小限制，但建议单个消息不超过 10MB，大文件请使用流式传输
- **并发请求**: 支持并发请求，每个请求都有独立的 `requestId` 进行管理
- **内存占用**: 轻量级实现，核心代码体积小，适合在生产环境使用

### 浏览器兼容性

| 浏览器 | 最低版本 | 说明 |
|--------|---------|------|
| Chrome | 49+ | 完整支持 |
| Firefox | 45+ | 完整支持 |
| Safari | 10+ | 完整支持 |
| Edge | 12+ | 完整支持 |
| IE | 不支持 | 使用 Babel 转译后可能支持 IE 11，但未测试 |

### 相关项目

- [axios](https://github.com/axios/axios) - 灵感来源的 HTTP 客户端库
- [Express](https://expressjs.com/) - Server API 设计参考


## 许可证

MIT License

