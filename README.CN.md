# request-iframe

像发送 HTTP 请求一样与 iframe / Window 通信！基于 `postMessage` 实现的浏览器跨页面通信库。

> 🌐 **Languages**: [English](./README.md) | [中文](./README.CN.md)

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-Ready-blue" alt="TypeScript Ready">
  <img src="https://img.shields.io/badge/API-Express%20Like-green" alt="Express Like API">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License">
  <img src="https://coveralls.io/repos/github/gxlmyacc/request-iframe/badge.svg?branch=main" alt="Coverage Status">
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
- [React Hooks](#react-hooks)
  - [useClient](#useclienttargetfnorref-options-deps)
  - [useServer](#useserveroptions-deps)
  - [useServerHandler](#useserverhandlerserver-path-handler-deps)
  - [useServerHandlerMap](#useserverhandlermapserver-map-deps)
  - [完整示例](#完整示例)
  - [最佳实践](#最佳实践)
- [错误处理](#错误处理)
- [FAQ](#faq)
- [开发](#开发)
- [许可证](#许可证)

## 为什么选择 request-iframe？

在微前端、iframe 嵌套、弹窗（window.open）等场景下，跨页面通信是常见需求。传统的 `postMessage` 通信存在以下痛点：

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
- 📁 **文件传输** - 支持文件通过流方式传输（Client↔Server）
- 🌊 **流式传输** - 支持大文件分块传输，支持异步迭代器
- 🧾 **分级日志** - 默认只输出 warn/error，可通过 `trace` 设置日志等级与调试日志
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

## CDN（UMD bundle）

本项目也支持构建 **可直接用 `<script>` 引入的 UMD bundle**（核心 + React hooks），方便放到 CDN 上。

- 核心 bundle 输出：`cdn/request-iframe.umd(.min).js` → 全局变量 `RequestIframe`
- React bundle 输出：`cdn/request-iframe-react.umd(.min).js` → 全局变量 `RequestIframeReact`
  - 依赖 `React` 全局变量（即 `react` 的 UMD 版本）
  - 依赖 `RequestIframe` 全局变量（先加载核心 bundle）

示例（使用 unpkg）：

```html
<!-- 核心 -->
<script src="https://unpkg.com/request-iframe@latest/cdn/request-iframe.umd.min.js"></script>

<!-- React（可选） -->
<script src="https://unpkg.com/react@latest/umd/react.production.min.js"></script>
<script src="https://unpkg.com/request-iframe@latest/cdn/request-iframe-react.umd.min.js"></script>

<script>
  const { requestIframeClient, requestIframeServer, requestIframeEndpoint } = RequestIframe;
  // React hooks 在 RequestIframeReact 上（例如 RequestIframeReact.useClient）
  console.log(!!requestIframeClient, !!requestIframeServer, !!requestIframeEndpoint);
<\/script>
```

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

## 该用哪个 API？

- **优先使用 `requestIframeClient()` + `requestIframeServer()`**：适用于主要是单向通信（父页 → iframe），并且你希望把“发送请求”和“处理请求”职责明确分开。
- **优先使用 `requestIframeEndpoint()`**：适用于需要 **双向通信**（双方都需要 `send()` + `on()/use()/map()`），或者你希望用一个门面对象更方便地串起全链路做调试。

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
       │  ──── ACK (可选) ───────────────────────>  │  确认收到响应
       │                                            │
```

### 消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| `request` | Client → Server | 客户端发起请求 |
| `ack` | 接收方 → 发送方 | 回执确认（当消息 `requireAck: true` 且被接管/处理时发送；ACK-only） |
| `async` | Server → Client | 通知客户端这是异步任务（handler 返回 Promise 时发送） |
| `response` | Server → Client | 返回响应数据 |
| `error` | Server → Client | 返回错误信息 |
| `ping` | Client → Server | 连接检测（`isConnect()`；可使用 `requireAck` 确认投递） |
| `pong` | Server → Client | 连接检测响应 |

### 超时机制

request-iframe 采用三阶段超时策略，智能适应不同场景：

```typescript
client.send('/api/getData', data, {
  ackTimeout: 1000,       // 阶段1：等待 ACK 的超时时间（默认 1000ms）
  timeout: 5000,          // 阶段2：请求超时时间（默认 5s）
  asyncTimeout: 120000,   // 阶段3：异步请求超时时间（默认 120s）
  requireAck: true        // 是否需要服务端 ACK（默认 true；为 false 则跳过 ACK 阶段，直接进入 timeout）
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
| ackTimeout | 较短（1000ms） | 快速检测 Server 是否在线，避免长时间等待不可达的 iframe。从 500ms 增加到 1000ms，以适应性能较差的环境或浏览器繁忙的场景 |
| timeout | 中等（5s） | 适用于简单的同步处理，如读取数据、参数校验等 |
| asyncTimeout | 较长（120s） | 适用于复杂异步操作，如文件处理、批量操作、第三方 API 调用等 |

**补充说明：**
- `requireAck: false` 会跳过 ACK 阶段，直接以 `timeout` 作为第一阶段计时。
- 流（Stream）有独立的可选空闲超时：`streamTimeout`（见「流式传输（Stream）」）。

### 协议版本

每条消息都包含 `__requestIframe__` 字段标识协议版本，以及 `timestamp` 字段记录消息创建时间：

```typescript
{
  __requestIframe__: 2,  // 协议版本号
  timestamp: 1704067200000,  // 消息创建时间戳（毫秒）
  type: 'request',
  requestId: 'req_xxx',
  path: '/api/getData',
  body: { ... }
}
```

这使得：
- 不同版本的库可以做兼容处理
- 当前协议版本为 `2`；对于新的 stream pull/ack 流程，建议双方保持一致版本
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
const userInfoResponse = await client.send('/api/user/info', {});
console.log(userInfoResponse.data); // 用户信息数据

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
const server = requestIframeServer({ secretKey: 'widget' });
server.on('/event', (req, res) => {
  console.log('组件事件:', req.body);
  res.send({ received: true });
});
```

### 弹窗 / 新标签页（Window 通信）

`request-iframe` 不仅可以与 iframe 通信，也可以把 `target` 直接传 `Window`（例如弹窗/新标签页）。

**重要前提**：你必须拿到对方页面的 `Window` 引用（例如 `window.open()` 的返回值，或通过 `window.opener` / `MessageEvent.source` 获取）。**无法**通过 URL 给“任意标签页”发消息。

```typescript
// 父页面：打开新标签页/弹窗
const child = window.open('https://child.example.com/page.html', '_blank');
if (!child) throw new Error('弹窗被拦截');

// 父 -> 子
const client = requestIframeClient(child, {
  secretKey: 'popup-demo',
  targetOrigin: 'https://child.example.com' // 强烈建议不要用 '*'
});
await client.send('/api/ping', { from: 'parent' });

// 子页面：创建 server
const server = requestIframeServer({ secretKey: 'popup-demo' });
server.on('/api/ping', (req, res) => res.send({ ok: true, echo: req.body }));
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
const response = await client.send('/api/data', {});
const data = response.data; // 成功获取跨域数据
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
if (response.data instanceof File || response.data instanceof Blob) {
  downloadFile(response.data);
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

**Cookie 有效期与生命周期（重要）：**

- **仅内存存储**：cookies 存在于 Client 实例内部的 `CookieStore`（不会写入浏览器真实 Cookie）。
- **生命周期**：默认从 `requestIframeClient()` 创建开始，直到 `client.destroy()` 为止。
- **`open()` / `close()`**：只控制消息监听的开启/关闭，**不会清空**内部 cookies。
- **过期处理**：会遵循 `Expires` / `Max-Age`。已过期的 cookie 在读取/发送时会被自动过滤（也可以用 `client.clearCookies()` / `client.removeCookie()` 手动清理）。

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
const userInfoResponse = await client.send('/api/getUserInfo', {});
const userInfo = userInfoResponse.data;

// Client 端：请求根路径（只携带 userId，因为 authToken 的 path 是 /api）
const rootResponse = await client.send('/other', {});
const rootData = rootResponse.data;
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

> 说明：文件传输（无论 Client→Server 还是 Server→Client）底层都会通过 stream 协议承载；你只需要使用 `client.sendFile()` / `res.sendFile()` 这一层 API 即可。

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
if (response.data instanceof File || response.data instanceof Blob) {
  const file = response.data instanceof File ? response.data : null;
  const fileName = file?.name || 'download';
  
  // 直接使用 File/Blob 下载文件
  const url = URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
```

#### Client → Server（Client 向 Server 发送文件）

Client 端发送文件使用 `sendFile()`（或直接 `send(path, file)`）；Server 端在 `autoResolve: true`（默认）时会把文件自动解析成 `File/Blob` 放到 `req.body`，当 `autoResolve: false` 时则通过 `req.stream` / `req.body` 暴露为 `IframeFileReadableStream`。

```typescript
// Client 端：发送文件（stream，autoResolve 默认 true）
const file = new File(['Hello Upload'], 'upload.txt', { type: 'text/plain' });
const response = await client.send('/api/upload', file);

// 或显式使用 sendFile
const blob = new Blob(['binary data'], { type: 'application/octet-stream' });
const response2 = await client.sendFile('/api/upload', blob, {
  fileName: 'data.bin',
  mimeType: 'application/octet-stream',
  autoResolve: true // 可选，默认 true：Server 在 req.body 里拿到 File/Blob
});

// Server 端：接收文件（autoResolve true → req.body 是 File/Blob）
server.on('/api/upload', async (req, res) => {
  const blob = req.body as Blob; // 如果 client 发送的是 File，这里也可能是 File
  const text = await blob.text();
  console.log('Received file content:', text);
  res.send({ success: true, size: blob.size });
});
```

**提示**：当 `client.send()` 的 `body` 是 `File/Blob` 时，会自动分发到 `client.sendFile()`。`autoResolve` 为 true（默认）时 Server 拿到 `req.body`（File/Blob），为 false 时拿到 `req.stream` / `req.body`（`IframeFileReadableStream`）。

### 流式传输（Stream）

Stream 除了用于大文件/分块传输，也可以用于“长连接 / 订阅式交互”（类似 SSE / WebSocket，但基于 `postMessage`）。常见用法有两类：

- **长连接/订阅**：Client 发起一次请求拿到 `response.stream`，然后用 `for await` 持续消费事件；需要结束时调用 `stream.cancel()`。
- **分块/文件流**：按 chunk 传输数据或文件（下方示例）。

> 长连接注意事项：
> - `IframeWritableStream` 默认会使用 `asyncTimeout` 作为 `expireTimeout`（避免泄露）。如果你的订阅需要更久，请显式设置更大的 `expireTimeout`，或设置 `expireTimeout: 0` 关闭自动过期（建议配合业务侧取消/重连，避免泄露）。
> - Server 端的 `res.sendStream(stream)` 会一直等待到流结束；如果你需要在后续主动 `write()` 推送数据，请不要直接 `await` 它，可以用 `void res.sendStream(stream)` 或保存返回的 Promise。
> - 如果启用了 `maxConcurrentRequestsPerClient`，一个长连接 stream 会占用一个并发槽，需要按业务场景调整。
> - **事件订阅**：stream 支持 `stream.on(event, listener)`（返回取消订阅函数），可用于埋点/进度/调试（如监听 `start/data/read/write/cancel/end/error/timeout/expired`）。主消费仍建议使用 `for await`。

#### 长连接 / 订阅式交互（push 模式示例）

```typescript
/**
 * Server 端：订阅（长连接）
 * - mode: 'push'：由写侧主动 write()
 * - expireTimeout: 0：关闭自动过期（谨慎使用，建议结合业务取消/重连）
 */
server.on('/api/subscribe', (req, res) => {
  const stream = new IframeWritableStream({
    type: 'data',
    chunked: true,
    mode: 'push',
    expireTimeout: 0,
    /** 可选：写侧空闲检测（等待 pull/ack 太久会做心跳并失败） */
    streamTimeout: 15000
  });

  /** 注意：不要 await，否则会一直等到流结束 */
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
 * Client 端：持续读取（长连接建议用 for await，而不是 readAll()）
 */
const resp = await client.send('/api/subscribe', {});
if (isIframeReadableStream(resp.stream)) {
  /** 事件订阅示例（可选） */
  const off = resp.stream.on(StreamEvent.ERROR, ({ error }) => {
    console.error('stream error:', error);
  });

  for await (const evt of resp.stream) {
    console.log('event:', evt);
  }

  off();
}
```

#### 分块 / 文件流示例

```typescript
import {
  StreamEvent,
  IframeWritableStream, 
  IframeFileWritableStream,
  isIframeReadableStream,
  isIframeFileReadableStream 
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
  // 如果希望返回类型稳定（始终是 chunk 数组），可使用 readAll()
  const allChunks = await response.stream.readAll();
  
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

if (isIframeFileReadableStream(fileResponse.stream)) {
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
| `IframeWritableStream` | 写侧（生产者）流：**谁要发送 stream，谁就创建它**；可用于 Server→Client 的响应流，也可用于 Client→Server 的请求流 |
| `IframeFileWritableStream` | 文件写侧（生产者）流：用于发送文件（底层会做 Base64 编码） |
| `IframeReadableStream` | 读侧（消费者）流：用于接收普通数据（无论来自 Server 还是 Client） |
| `IframeFileReadableStream` | 文件读侧（消费者）流：用于接收文件（底层会做 Base64 解码） |

> **注意**：文件流内部会进行 Base64 编/解码。Base64 会带来约 33% 的体积膨胀，并且在超大文件场景下可能会有较高的内存/CPU 开销。大文件建议使用 **分块** 文件流（`chunked: true`），并控制 chunk 大小（例如 256KB–1MB）。

**流选项：**

```typescript
interface WritableStreamOptions {
  type?: 'data' | 'file';    // 流类型
  chunked?: boolean;          // 是否分块传输（默认 true）
  mode?: 'pull' | 'push';     // 流模式：pull(默认，按需拉取) / push(主动写入)
  expireTimeout?: number;     // 流过期时间（ms，可选；默认约等于 asyncTimeout）
  streamTimeout?: number;     // 写侧空闲超时（ms，可选）：长时间未收到对端 pull/ack 时会做心跳确认并失败
  iterator?: () => AsyncGenerator;  // 数据生成迭代器
  next?: () => Promise<{ data: any; done: boolean }>;  // 数据生成函数
  maxPendingChunks?: number;  // 写侧待发送缓冲上限（可选；push/长连接场景建议配置，避免 pendingQueue 无限增长）
  maxPendingBytes?: number;   // 写侧待发送字节上限（可选；避免单次 write 超大 chunk 导致内存暴涨）
  metadata?: Record<string, any>;   // 自定义元数据
}
```

**流超时/保活：**
- `streamTimeout`（请求参数）：读侧空闲超时（ms，可选）。消费 `response.stream` 时超过该时间未收到新的 chunk，会先做一次心跳确认（默认使用 `client.isConnect()`），失败则认为流已断开并报错。
- `streamTimeout`（流参数）：写侧空闲超时（ms，可选）。写侧在 pull 协议下，若长时间未收到对端 `pull`，会做心跳确认并失败（避免长时间无效占用）。
- `expireTimeout`（流参数）：写侧有效期；过期后会发送 `stream_error`，读侧会收到明确的“已过期”错误。
- `maxPendingChunks`（流参数）：写侧待发送缓冲上限（可选）。对 `push` / 长连接场景很重要：当对端停止 pull 时，继续 `write()` 会在写侧积压，建议设置上限防止内存无限增长。
- `maxPendingBytes`（流参数）：写侧待发送字节上限（可选）。用于防止单次写入超大 chunk（例如大字符串/大 Blob 包装）导致内存占用过高。

**pull/ack 协议（新增，默认启用）：**
- 读侧会自动发送 `stream_pull` 请求更多 chunk；写侧只会在收到 `stream_pull` 后才继续发送 `stream_data`，实现真正的背压（按需拉取）。
  - 断连检测不依赖 `stream_ack`，而是通过 `streamTimeout + 心跳(isConnect)` 来实现。

**consume 默认行为（变更）：**
- `for await (const chunk of stream)` 默认会 **消费并丢弃已迭代过的 chunk**（`consume: true`），避免长流场景内存无限增长。
- 如果你希望后续还能 `read()/readAll()` 拿到历史数据，可在创建流时传 `consume: false`（或在业务上自行缓存）。

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
  const acked = await res.send(data, { requireAck: true });
  
  if (acked) {
    console.log('客户端已确认收到');
  } else {
    console.log('客户端未确认（超时）');
  }
});
```

> **说明**：当响应/错误被客户端“接管”（即存在对应的 pending request）时，库会自动发送 `ack`，无需业务侧手动发送。

### 追踪模式

默认情况下，request-iframe 只会输出 **warn/error** 日志（避免生产环境控制台过于吵闹）。

开启追踪模式（或设置日志等级）可以在控制台查看更详细的通信日志：

```typescript
import { LogLevel } from 'request-iframe';

const client = requestIframeClient(iframe, { 
  secretKey: 'demo',
  trace: true // 等价于 LogLevel.TRACE
});

const server = requestIframeServer({ 
  secretKey: 'demo',
  trace: LogLevel.INFO // 输出 info/warn/error（比 trace 更克制）
});

// 控制台输出：
// [request-iframe] [INFO] 📤 Request Start { path: '/api/getData', ... }
// [request-iframe] [INFO] 📨 ACK Received { requestId: '...' }
// [request-iframe] [INFO] ✅ Request Success { status: 200, data: {...} }
```

`trace` 支持：
- `true` / `false`
- `'trace' | 'info' | 'warn' | 'error' | 'silent'`（或 `LogLevel.*`）

说明：
- 当 `trace` 为 `LogLevel.TRACE` / `LogLevel.INFO` 时，库会额外挂载内置的调试拦截器/监听器，以输出更丰富的 request/response 日志。
- 当 `trace` 为 `LogLevel.WARN` / `LogLevel.ERROR` / `LogLevel.SILENT` 时，只影响日志输出等级（不会额外挂载调试拦截器）。

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
| `options.trace` | `boolean \| 'trace' \| 'info' \| 'warn' \| 'error' \| 'silent'` | trace/日志等级（可选）。默认只输出 warn/error |
| `options.targetOrigin` | `string` | 覆盖 postMessage 的 targetOrigin（可选）。当 `target` 是 `Window` 时默认 `*`；当 `target` 是 iframe 时默认取 `iframe.src` 的 origin。 |
| `options.ackTimeout` | `number` | 全局默认 ACK 确认超时（ms），默认 1000 |
| `options.timeout` | `number` | 全局默认请求超时（ms），默认 5000 |
| `options.asyncTimeout` | `number` | 全局默认异步超时（ms），默认 120000 |
| `options.requireAck` | `boolean` | 全局默认请求投递 ACK（默认 true）。为 false 时请求跳过 ACK 阶段，直接进入 timeout |
| `options.streamTimeout` | `number` | 全局默认流空闲超时（ms，可选），用于消费 `response.stream` |
| `options.allowedOrigins` | `string \| RegExp \| Array<string \| RegExp>` | 接收消息的 origin 白名单（可选，生产环境强烈建议配置） |
| `options.validateOrigin` | `(origin, data, context) => boolean` | 自定义 origin 校验函数（可选，优先级高于 `allowedOrigins`） |

**返回值：** `RequestIframeClient`

**关于 `target: Window` 的说明：**
- **必须持有对方页面的 `Window` 引用**（例如 `window.open()` 返回值、`window.opener`、或 `MessageEvent.source`）。
- **无法**通过 URL 给“任意标签页”发消息。
- 安全起见，建议显式设置 `targetOrigin`，并配置 `allowedOrigins` / `validateOrigin`。

**生产环境推荐配置（模板）：**

```typescript
import { requestIframeClient, requestIframeServer } from 'request-iframe';

/**
 * 建议：明确限定 3 件事
 * - secretKey：隔离不同业务/不同实例，避免消息串线
 * - targetOrigin：发送时的 targetOrigin（Window 场景强烈建议不要用 '*'）
 * - allowedOrigins / validateOrigin：接收时的 origin 白名单校验
 */
const secretKey = 'my-app';
const targetOrigin = 'https://child.example.com';
const allowedOrigins = [targetOrigin];

// Client（父页）
const client = requestIframeClient(window.open(targetOrigin)!, {
  secretKey,
  targetOrigin,
  allowedOrigins
});

// Server（子页/iframe 内）
const server = requestIframeServer({
  secretKey,
  allowedOrigins,
  // 防止异常/攻击导致消息爆炸（按需设置）
  maxConcurrentRequestsPerClient: 50
});
```

**生产环境推荐配置（iframe 场景模板）：**

```typescript
import { requestIframeClient, requestIframeServer } from 'request-iframe';

/**
 * iframe 场景通常可以从 iframe.src 推导 targetOrigin，并用它作为 allowedOrigins 白名单。
 */
const iframe = document.querySelector('iframe')!;
const targetOrigin = new URL(iframe.src).origin;
const secretKey = 'my-app';

// Client（父页）
const client = requestIframeClient(iframe, {
  secretKey,
  // 可显式写出来（即使库内部也会默认推导），便于审计/避免误用 '*'
  targetOrigin,
  allowedOrigins: [targetOrigin]
});

// Server（iframe 内）
const server = requestIframeServer({
  secretKey,
  allowedOrigins: [targetOrigin],
  maxConcurrentRequestsPerClient: 50
});
```

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
| `options.trace` | `boolean \| 'trace' \| 'info' \| 'warn' \| 'error' \| 'silent'` | trace/日志等级（可选）。默认只输出 warn/error |
| `options.ackTimeout` | `number` | 等待客户端确认超时（ms），默认 1000 |
| `options.maxConcurrentRequestsPerClient` | `number` | 每个客户端的最大并发 in-flight 请求数（按 origin + creatorId 维度），默认 Infinity |
| `options.allowedOrigins` | `string \| RegExp \| Array<string \| RegExp>` | 接收消息的 origin 白名单（可选，生产环境强烈建议配置） |
| `options.validateOrigin` | `(origin, data, context) => boolean` | 自定义 origin 校验函数（可选，优先级高于 `allowedOrigins`） |

**返回值：** `RequestIframeServer`

### requestIframeEndpoint(target, options?)

创建一个 **endpoint 门面**（client + server）并绑定到某个对端窗口/iframe。

它可以：
- **向对端发送请求**：`endpoint.send(...)`
- **处理对端发来的请求**：`endpoint.on(...)` / `endpoint.use(...)` / `endpoint.map(...)`

说明：
- 内部的 client/server 是 **懒创建** 的（只有首次使用发送/注册 handler 等能力时才会创建）。
- 如果传了 `options.id`，它会作为 client+server 的共享 id；不传则会自动生成一个。
- `options.trace` 与 client/server 一致，推荐用 `LogLevel.*` 来配置日志等级。

示例（使用 endpoint 做双向通信，推荐）：

```typescript
import { requestIframeEndpoint, LogLevel } from 'request-iframe';

// 父页面（持有 iframe 元素）
const iframe = document.querySelector('iframe')!;
const parentEndpoint = requestIframeEndpoint(iframe, {
  secretKey: 'demo',
  trace: LogLevel.INFO
});
parentEndpoint.on('/notify', (req, res) => res.send({ ok: true, echo: req.body }));

// iframe 页面（持有 window.parent）
const iframeEndpoint = requestIframeEndpoint(window.parent, {
  secretKey: 'demo',
  targetOrigin: 'https://parent.example.com',
  trace: true
});
iframeEndpoint.on('/api/ping', (req, res) => res.send({ ok: true }));

// 任意一侧都可以 send + handle
await parentEndpoint.send('/api/ping', { from: 'parent' });
await iframeEndpoint.send('/notify', { from: 'iframe' });
```

生产环境推荐配置（模板）：

```typescript
import { requestIframeEndpoint, LogLevel } from 'request-iframe';

const secretKey = 'my-app';
const iframe = document.querySelector('iframe')!;
const targetOrigin = new URL(iframe.src).origin;

const endpoint = requestIframeEndpoint(iframe, {
  secretKey,
  targetOrigin,
  allowedOrigins: [targetOrigin],
  // 防止异常/攻击导致消息爆炸（按需设置）
  maxConcurrentRequestsPerClient: 50,
  // 日志：默认只输出 warn/error；调试时可切到 LogLevel.INFO / LogLevel.TRACE
  trace: LogLevel.WARN
});
```

### Client API

#### client.send(path, body?, options?)

发送请求。会根据 body 类型自动分发到 `sendFile()` 或 `sendStream()`：
- `File/Blob` → `sendFile()`
- `IframeWritableStream` → `sendStream()`

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | `string` | 请求路径 |
| `body` | `any` | 请求数据（可选）。可以是普通对象、File、Blob、或 IframeWritableStream；会自动分发：File/Blob → `sendFile()`，IframeWritableStream → `sendStream()` |
| `options.ackTimeout` | `number` | ACK 确认超时（ms），默认 1000 |
| `options.timeout` | `number` | 请求超时（ms），默认 5000 |
| `options.asyncTimeout` | `number` | 异步超时（ms），默认 120000 |
| `options.requireAck` | `boolean` | 是否需要服务端 ACK（默认 true）。为 false 时跳过 ACK 阶段 |
| `options.streamTimeout` | `number` | 流空闲超时（ms，可选），用于消费 `response.stream` |
| `options.headers` | `object` | 请求 headers（可选） |
| `options.cookies` | `object` | 请求 cookies（可选，会与内部存储的 cookies 合并，传入的优先级更高） |
| `options.requestId` | `string` | 自定义请求 ID（可选） |

**返回值：** `Promise<Response>`

```typescript
interface Response<T = any> {
  data: T;                    // 响应数据（自动解析的文件流为 File/Blob）
  status: number;             // 状态码
  statusText: string;         // 状态文本
  requestId: string;          // 请求 ID
  headers?: Record<string, string | string[]>;  // 响应 headers（Set-Cookie 为数组）
  stream?: IIframeReadableStream<T>;  // 流响应（如果有）
}
```

**示例：**

```typescript
// 发送普通对象（自动 Content-Type: application/json）
await client.send('/api/data', { name: 'test' });

// 发送字符串（自动 Content-Type: text/plain）
await client.send('/api/text', 'Hello');

// 发送 File/Blob（自动分发到 sendFile）
const file = new File(['content'], 'test.txt');
await client.send('/api/upload', file);

// 发送流（自动分发到 sendStream）
const stream = new IframeWritableStream({ iterator: async function* () { yield 'data'; } });
await client.send('/api/uploadStream', stream);
```

#### client.sendFile(path, content, options?)

发送文件作为请求体（通过流传输；当 `autoResolve` 为 true 时，Server 在 `req.body` 中拿到 File/Blob）。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | `string` | 请求路径 |
| `content` | `string \| Blob \| File` | 文件内容 |
| `options.mimeType` | `string` | MIME 类型（可选，优先使用 content.type） |
| `options.fileName` | `string` | 文件名（可选） |
| `options.autoResolve` | `boolean` | 为 true（默认）时 Server 在 `req.body` 中拿到 File/Blob；为 false 时 Server 在 `req.stream` / `req.body` 中拿到 `IframeFileReadableStream` |
| `options.ackTimeout` | `number` | ACK 确认超时（ms），默认 1000 |
| `options.timeout` | `number` | 请求超时（ms），默认 5000 |
| `options.asyncTimeout` | `number` | 异步超时（ms），默认 120000 |
| `options.requireAck` | `boolean` | 是否需要服务端 ACK（默认 true）。为 false 时跳过 ACK 阶段 |
| `options.streamTimeout` | `number` | 流空闲超时（ms，可选），用于消费 `response.stream` |
| `options.headers` | `object` | 请求 headers（可选） |
| `options.cookies` | `object` | 请求 cookies（可选） |
| `options.requestId` | `string` | 自定义请求 ID（可选） |

**返回值：** `Promise<Response>`

**说明：** 文件通过流发送。`autoResolve` 为 true（默认）时 Server 收到 `req.body`（File/Blob）；为 false 时 Server 收到 `req.stream` / `req.body`（`IframeFileReadableStream`）。

#### client.sendStream(path, stream, options?)

发送流作为请求体（Server 端收到可读流）。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | `string` | 请求路径 |
| `stream` | `IframeWritableStream` | 要发送的可写流 |
| `options.ackTimeout` | `number` | ACK 确认超时（ms），默认 1000 |
| `options.timeout` | `number` | 请求超时（ms），默认 5000 |
| `options.asyncTimeout` | `number` | 异步超时（ms），默认 120000 |
| `options.requireAck` | `boolean` | 是否需要服务端 ACK（默认 true）。为 false 时跳过 ACK 阶段 |
| `options.streamTimeout` | `number` | 流空闲超时（ms，可选），用于消费 `response.stream` |
| `options.headers` | `object` | 请求 headers（可选） |
| `options.cookies` | `object` | 请求 cookies（可选） |
| `options.requestId` | `string` | 自定义请求 ID（可选） |

**返回值：** `Promise<Response>`

**说明：** Server 端的流在 `req.stream`（`IIframeReadableStream`）中，可用 `for await (const chunk of req.stream)` 迭代读取。

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

**ServerRequest 接口：**

```typescript
interface ServerRequest {
  body: any;                          // 请求 body（普通数据；或 autoResolve=true 时的 File/Blob）
  stream?: IIframeReadableStream;     // 请求流（sendStream；或 sendFile 且 autoResolve=false）
  headers: Record<string, string>;    // 请求 headers
  cookies: Record<string, string>;    // 请求 cookies
  path: string;                       // 请求路径（实际请求路径）
  params: Record<string, string>;     // 路由参数（由 server.on 注册的路径模式解析得出，如 /api/users/:id）
  requestId: string;                  // 请求 ID
  origin: string;                     // 来源 origin
  source: Window;                     // 来源 window
  res: ServerResponse;                // 关联的 Response 对象
}
```

**说明：**
- Client 通过 `sendFile()`（或 `send(path, file)`）发送文件时：文件通过流传输；`autoResolve` 为 true（默认）时 Server 在 `req.body` 中拿到 File/Blob；为 false 时在 `req.stream` / `req.body` 中拿到 `IframeFileReadableStream`。
- Client 通过 `sendStream()` 发送流时：Server 在 `req.stream` 中拿到 `IIframeReadableStream`，可用 `for await` 迭代读取。
- **路径参数（类似 Express）**：支持 `/api/users/:id` 形式的路由参数，解析结果在 `req.params` 中。

```typescript
server.on('/api/users/:id', (req, res) => {
  res.send({ userId: req.params.id });
});

server.on('/api/users/:userId/posts/:postId', (req, res) => {
  const { userId, postId } = req.params;
  res.send({ userId, postId });
});
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

---

## React Hooks

request-iframe 提供了 React hooks，方便在 React 应用中使用。从 `request-iframe/react` 导入 hooks：

> 注意：只有在使用 `request-iframe/react` 时才需要安装 React；单独安装 `request-iframe` 不依赖 React。

```typescript
import { useClient, useServer, useServerHandler, useServerHandlerMap } from 'request-iframe/react';
```

### useClient(targetFnOrRef, options?, deps?)

用于使用 request-iframe client 的 React hook。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `targetFnOrRef` | `(() => HTMLIFrameElement \| Window \| null) \| RefObject<HTMLIFrameElement \| Window>` | 返回 iframe 元素或 Window 对象的函数，或 React ref 对象 |
| `options` | `RequestIframeClientOptions` | Client 选项（可选） |
| `deps` | `readonly unknown[]` | 依赖数组（可选，当依赖变化时重新创建 client） |

**返回值：** `RequestIframeClient | null`

**示例：**

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
      <button onClick={handleClick}>发送请求</button>
    </div>
  );
};
```

**使用函数而不是 ref：**

```tsx
const MyComponent = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const client = useClient(() => iframeRef.current, { secretKey: 'my-app' });
  // ...
};
```

### useServer(options?, deps?)

用于使用 request-iframe server 的 React hook。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `options` | `RequestIframeServerOptions` | Server 选项（可选） |
| `deps` | `readonly unknown[]` | 依赖数组（可选，当依赖变化时重新创建 server） |

**返回值：** `RequestIframeServer | null`

**示例：**

```tsx
import { useServer } from 'request-iframe/react';

const MyComponent = () => {
  const server = useServer({ secretKey: 'my-app' });

  useEffect(() => {
    if (!server) return;

    const off = server.on('/api/data', (req, res) => {
      res.send({ data: 'Hello' });
    });

    return off; // 组件卸载时清理
  }, [server]);

  return <div>Server 组件</div>;
};
```

### useServerHandler(server, path, handler, deps?)

用于注册单个 server handler 的 React hook，自动处理清理和闭包问题。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `server` | `RequestIframeServer \| null` | Server 实例（来自 `useServer`） |
| `path` | `string` | 路由路径 |
| `handler` | `ServerHandler` | 处理函数 |
| `deps` | `readonly unknown[]` | 依赖数组（可选，当依赖变化时重新注册） |

**示例：**

```tsx
import { useServer, useServerHandler } from 'request-iframe/react';
import { useState } from 'react';

const MyComponent = () => {
  const server = useServer();
  const [userId, setUserId] = useState(1);

  // Handler 自动使用最新的 userId 值
  useServerHandler(server, '/api/user', (req, res) => {
    res.send({ userId, data: 'Hello' });
  }, [userId]); // 当 userId 变化时重新注册

  return <div>Server 组件</div>;
};
```

**关键特性：**
- 自动处理闭包问题 - 始终使用依赖项的最新值
- 组件卸载或依赖变化时自动取消注册 handler
- 无需手动管理 handler 的注册/清理

### useServerHandlerMap(server, map, deps?)

用于批量注册多个 server handlers 的 React hook，自动处理清理。

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `server` | `RequestIframeServer \| null` | Server 实例（来自 `useServer`） |
| `map` | `Record<string, ServerHandler>` | 路由路径和处理函数的映射 |
| `deps` | `readonly unknown[]` | 依赖数组（可选，当依赖变化时重新注册） |

**示例：**

```tsx
import { useServer, useServerHandlerMap } from 'request-iframe/react';
import { useState } from 'react';

const MyComponent = () => {
  const server = useServer();
  const [userId, setUserId] = useState(1);

  // 一次性注册多个 handlers
  useServerHandlerMap(server, {
    '/api/user': (req, res) => {
      res.send({ userId, data: '用户数据' });
    },
    '/api/posts': (req, res) => {
      res.send({ userId, data: '文章数据' });
    }
  }, [userId]); // 当 userId 变化时重新注册所有 handlers

  return <div>Server 组件</div>;
};
```

**关键特性：**
- 批量注册多个 handlers
- 自动处理闭包问题 - 始终使用依赖项的最新值
- 组件卸载或依赖变化时自动取消注册所有 handlers
- 高效 - 仅在 map 的键变化时重新注册

### 完整示例

以下是一个完整的示例，展示如何在真实应用中使用 React hooks：

```tsx
import { useClient, useServer, useServerHandler } from 'request-iframe/react';
import { useRef, useState } from 'react';

// 父组件（Client）
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
      console.error('请求失败:', error);
    }
  };

  return (
    <div>
      <iframe ref={iframeRef} src="/iframe.html" />
      <button onClick={fetchData}>获取数据</button>
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
};

// Iframe 组件（Server）
const IframeComponent = () => {
  const server = useServer({ secretKey: 'my-app' });
  const [userId, setUserId] = useState(1);

  // 注册 handler，自动清理
  useServerHandler(server, '/api/data', async (req, res) => {
    // Handler 始终使用最新的 userId 值
    const userData = await fetchUserData(userId);
    res.send(userData);
  }, [userId]);

  return (
    <div>
      <p>用户 ID: {userId}</p>
      <button onClick={() => setUserId(userId + 1)}>增加</button>
    </div>
  );
};
```

### 最佳实践

1. **始终检查 null**：Client 和 server hooks 在初始时或目标不可用时可能返回 `null`：
   ```tsx
   const client = useClient(iframeRef);
   if (!client) return null; // 处理 null 情况
   ```

2. **使用依赖数组**：向 hooks 传递依赖项，确保 handlers 使用最新值：
   ```tsx
   useServerHandler(server, '/api/data', (req, res) => {
     res.send({ userId }); // 始终使用最新的 userId
   }, [userId]); // 当 userId 变化时重新注册
   ```

3. **自动清理**：Hooks 在组件卸载时自动清理，但你也可以手动取消注册：
   ```tsx
   useEffect(() => {
     if (!server) return;
     const off = server.on('/api/data', handler);
     return off; // 手动清理（可选，hooks 会自动处理）
   }, [server]);
   ```

---

## 错误处理

```typescript
interface ServerRequest {
  body: any;                          // 请求 body（普通数据；或 autoResolve=true 时的 File/Blob）
  stream?: IIframeReadableStream;     // 请求流（sendStream；或 sendFile 且 autoResolve=false）
  headers: Record<string, string>;    // 请求 headers
  cookies: Record<string, string>;    // 请求 cookies
  path: string;                       // 请求路径（实际请求路径）
  params: Record<string, string>;     // 路由参数（由 server.on 注册的路径模式解析得出，如 /api/users/:id）
  requestId: string;                  // 请求 ID
  origin: string;                     // 来源 origin
  source: Window;                     // 来源 window
  res: ServerResponse;                // 关联的 Response 对象
}
```

**路径参数（类似 Express）**：

支持使用 `:param` 形式声明路由参数，解析结果在 `req.params` 中。

```typescript
server.on('/api/users/:id', (req, res) => {
  // 请求 /api/users/123 时：req.params.id === '123'
  res.send({ userId: req.params.id });
});

server.on('/api/users/:userId/posts/:postId', (req, res) => {
  const { userId, postId } = req.params;
  res.send({ userId, postId });
});
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
  formatMessage,

  // 日志等级
  LogLevel
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
| `STREAM_TIMEOUT` | 流空闲超时 |
| `STREAM_EXPIRED` | 流已过期（可写流超过有效期） |
| `STREAM_CANCELLED` | 流被取消 |
| `STREAM_NOT_BOUND` | 流未绑定到请求上下文 |
| `STREAM_START_TIMEOUT` | 流启动超时（请求体 stream_start 未按时到达） |
| `TOO_MANY_REQUESTS` | 请求过多（服务端并发限制） |

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

request-iframe 是请求-响应模式，Server 本身不能“主动推送”。

如需双向通信，有两种做法：
- iframe 内创建一个反向的 Client（传统做法）
- 双方都使用 `requestIframeEndpoint()`（推荐），一个对象同时具备 **send + handle**

```typescript
// iframe 内
const server = requestIframeServer({ secretKey: 'my-app' });
const client = requestIframeClient(window.parent, { secretKey: 'my-app-reverse' });

// 主动向父页面发送消息
await client.send('/notify', { event: 'data-changed' });
```

### 5. 如何调试通信问题？

1. **按日志等级开启输出**：默认只输出 warn/error；建议设置 `trace: LogLevel.INFO`（或 `trace: true`）来输出更详细的通信日志
2. **检查 secretKey**：确保双方使用相同的 `secretKey`
3. **检查 iframe 加载**：确保 iframe 已完全加载
4. **检查 origin 约束**：尽量设置严格的 `targetOrigin`，并配置 `allowedOrigins` / `validateOrigin`，避免因为校验失败导致消息被忽略
5. **考虑使用 `requestIframeEndpoint()`**：把双向（send + handle）能力合在一个对象里，更容易串起完整链路做排查

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

### 9. trace/日志等级怎么用？

- 推荐优先使用常量：`trace: LogLevel.INFO` / `trace: LogLevel.TRACE`
- 如果你在做双向排查，推荐使用 `requestIframeEndpoint()` 并把 trace 打开（这样 send/handle 都在同一对象上更直观）

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
│   ├── impl/             # 实现层（client, server, request, response）
│   ├── endpoint/         # endpoint 基础设施（hub/inbox/outbox + stream/heartbeat 等）
│   ├── message/          # 消息通信层（channel, dispatcher）
│   ├── stream/           # 流式传输实现
│   ├── interceptors/    # 拦截器实现
│   ├── utils/            # 工具函数
│   ├── constants/        # 常量定义
│   ├── types/            # TypeScript 类型定义
├── __tests__/             # 测试文件（Jest）
├── react/__tests__/       # React hooks 测试
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

