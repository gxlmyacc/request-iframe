# 快速开始

5 分钟上手 request-iframe，像发送 HTTP 请求一样与 iframe 通信！

## 安装

```bash
npm install request-iframe
# 或
yarn add request-iframe
```

## 场景说明

假设你有一个父页面需要和嵌入的 iframe 通信：

```
┌─────────────────────────────────────────┐
│  父页面 (parent.html)                    │
│  ┌───────────────────────────────────┐  │
│  │  iframe (child.html)              │  │
│  │                                   │  │
│  │  需要获取 iframe 内的数据           │  │
│  │                                   │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Step 1: 父页面创建 Client

```typescript
/** parent.html */
import { requestIframeClient } from 'request-iframe';

/** 获取 iframe 元素 */
const iframe = document.getElementById('my-iframe') as HTMLIFrameElement;

/** 建议等待 iframe load，避免 contentWindow 尚未就绪导致通信失败 */
await new Promise<void>((resolve) => iframe.addEventListener('load', () => resolve(), { once: true }));

/** 创建 client（用于发送请求） */
const client = requestIframeClient(iframe, { 
  secretKey: 'my-app',  /** 消息隔离标识，需要和 iframe 内保持一致 */
  /**
   * strict: true 会把 targetOrigin/allowedOrigins 默认收敛到当前域名（window.location.origin）
   * - 适用于同源 iframe
   * - **注意：strict 不等于跨域安全配置**；若跨域，请显式配置 targetOrigin + allowedOrigins/validateOrigin
   */
  strict: true
});

// 发送请求并等待响应
async function getUserInfo(userId: number) {
  const response = await client.send('/api/getUserInfo', { userId });
  return response.data;
}

// 使用
const user = await getUserInfo(123);
console.log(user); // { name: 'Tom', age: 18 }
```

## Step 2: iframe 内创建 Server

```typescript
/** child.html（iframe 内） */
import { requestIframeServer } from 'request-iframe';

/**
 * 创建 server（用于接收请求）
 * - 生产环境强烈建议配置 allowedOrigins / validateOrigin
 * - 这里使用同源 demo：父页面 origin === iframe 内页面 origin
 *   若跨域，请改成父页面的 origin（例如 'https://parent.example.com'）
 */
const server = requestIframeServer({ 
  secretKey: 'my-app',  /** 必须和父页面的 client 保持一致！ */
  strict: true
});

// 注册请求处理器
server.on('/api/getUserInfo', (req, res) => {
  const { userId } = req.body;
  
  // 模拟从数据库获取用户信息
  const user = { name: 'Tom', age: 18 };
  
  // 返回响应
  res.send(user);
});
```

**就是这么简单！** 🎉

---

## 更多示例

### 异步处理

```typescript
// Server 端
server.on('/api/fetchData', async (req, res) => {
  // 异步操作（如网络请求）
  const data = await fetch('https://api.example.com/data').then(r => r.json());
  res.send(data);
});
```

当处理器返回 Promise 时，框架会自动：
1. 通知 Client 这是异步任务
2. 将超时时间从 5 秒切换到 120 秒

### 错误处理

```typescript
// Server 端
server.on('/api/getData', (req, res) => {
  if (!req.body.id) {
    return res.status(400).send({ error: '缺少 id 参数' });
  }
  res.send({ data: '...' });
});

// Client 端
try {
  const response = await client.send('/api/getData', {});
} catch (error) {
  if (error.response?.status === 400) {
    console.error('参数错误:', error.response.data.error);
  }
}
```

### 添加鉴权

```typescript
// Server 端添加中间件
server.use((req, res, next) => {
  const token = req.headers['authorization'];
  
  if (!token || !isValidToken(token)) {
    return res.status(401).send({ error: '未授权' });
  }
  
  next(); // 继续执行
});

// Client 端添加请求拦截器
client.interceptors.request.use((config) => {
  config.headers = {
    ...config.headers,
    'Authorization': `Bearer ${getToken()}`
  };
  return config;
});
```

### 批量注册接口

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

### 文件下载

```typescript
// Server 端
server.on('/api/download', async (req, res) => {
  const content = '这是文件内容';
  await res.sendFile(content, {
    mimeType: 'text/plain',
    fileName: 'example.txt'
  });
});

// Client 端
const response = await client.send('/api/download', {});
if (response.data instanceof File || response.data instanceof Blob) {
  const file = response.data instanceof File ? response.data : null;
  const fileName = file?.name || 'download';

  // 创建下载链接
  const url = URL.createObjectURL(response.data);

  // 触发下载
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
```

### 文件上传（Client → Server）

Client 向 Server 发送文件仅走**流式**。默认 `autoResolve: true`，Server 会在进入 handler 前把文件解析成 `File/Blob` 放到 `req.body`。

```typescript
// Client 端
const file = new File(['Hello Upload'], 'upload.txt', { type: 'text/plain' });
await client.send('/api/upload', file); // File/Blob 会自动分发到 sendFile（走流式）

// Server 端
server.on('/api/upload', async (req, res) => {
  const blob = req.body as Blob;
  const text = await blob.text();
  res.send({ ok: true, text });
});
```

### 路由参数（req.params）

支持 Express 风格的 `:param` 路由参数，解析结果在 `req.params`。

```typescript
server.on('/api/users/:id', (req, res) => {
  res.send({ userId: req.params.id });
});
```

### 调试模式

开启 trace 模式查看详细日志：

```typescript
import { LogLevel } from 'request-iframe';

const client = requestIframeClient(iframe, { 
  secretKey: 'my-app',
  /** 建议配置 targetOrigin/allowedOrigins（见 Step 1） */
  trace: LogLevel.INFO  // 输出 info/warn/error（也可以用 true 开启 TRACE）
});

const server = requestIframeServer({ 
  secretKey: 'my-app',
  /** 建议配置 allowedOrigins/validateOrigin（见 Step 2） */
  trace: true
});
```

控制台会输出：
```
[request-iframe] [INFO] 📤 Request Start { path: '/api/getData', body: {...} }
[request-iframe] [INFO] 📨 ACK Received { requestId: 'req_xxx' }
[request-iframe] [INFO] ✅ Request Success { status: 200, data: {...} }
```

---

## 常见问题

### Q: 为什么请求一直超时？

检查以下几点：
1. iframe 是否已加载完成
2. Client 和 Server 的 `secretKey` 是否一致
3. Server 的处理器路径是否正确

### Q: 如何在 iframe 内向父页面发送请求？

```typescript
/**
 * iframe 内
 * - Window 场景必须显式设置 targetOrigin，并把它加入 allowedOrigins
 */
const parentOrigin = 'https://parent.example.com';
const client = requestIframeClient(window.parent, { secretKey: 'reverse', targetOrigin: parentOrigin, allowedOrigins: [parentOrigin] });
await client.send('/notify', { event: 'ready' });

/** 父页面（allowedOrigins 应配置为 iframe 的 origin） */
const iframeOrigin = 'https://child.example.com';
const server = requestIframeServer({ secretKey: 'reverse', allowedOrigins: [iframeOrigin] });
server.on('/notify', (req, res) => {
  console.log('iframe 已就绪');
  res.send({ ok: true });
});
```

### Q: 支持 TypeScript 吗？

完全支持！所有 API 都有完整的类型定义。

```typescript
import { 
  requestIframeClient, 
  requestIframeServer,
  Response,
  ServerRequest,
  ServerResponse 
} from 'request-iframe';

// 泛型支持
interface User {
  id: number;
  name: string;
}

const response = await client.send<User>('/api/user', { id: 1 });
console.log(response.data.name); // TypeScript 知道这是 string
```

---

## 下一步

- 查看 [README.CN.md](./README.CN.md) 了解完整 API（中文）
- 查看 [README.md](./README.md) 了解完整 API（English）
- 查看 [`__tests__/`](./__tests__) 与 [`react/__tests__/`](./react/__tests__) 下的测试用例获取更多示例
