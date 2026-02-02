## Unreleased

## 0.2.2 (2026-02-02)

### Breaking / Migration notes

- **File stream semantics changed**: `IframeFile*Stream` chunks represent **bytes** (binary `Uint8Array/ArrayBuffer`, and strings are encoded/decoded as **UTF-8**). If you had custom `iterator/next` that yielded base64 strings, change it to yield `Uint8Array/ArrayBuffer`.

### Added

- **Strict mode**: `strict: true` is available on `requestIframeClient` / `requestIframeServer` / `requestIframeEndpoint` to provide safer same-origin defaults when you don't explicitly configure `targetOrigin/allowedOrigins/validateOrigin`. **Note**: strict is not a cross-origin security configuration.

### Docs

- Updated README / QuickStart defaults to use `strict: true` for same-origin examples, and kept explicit `targetOrigin + allowedOrigins/validateOrigin` for cross-origin examples.

## 0.1.0 (2026-01-31)

- **Protocol**: `__requestIframe__` CURRENT bumped to `2` (minimum supported version remains `1`).
- **ACK**: `requireAck` flow generalized (auto-ack for delivery/received).
- **Stream**: Chunk-level `stream_pull` backpressure flow, `push/pull` modes, and `stream_start.mode` propagated to the read side (per-frame requireAck uses unified `ack`).
- **Server**: `maxConcurrentRequestsPerClient` added to limit per-client in-flight requests (mitigate message explosion / DoS).

