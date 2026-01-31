## Unreleased

## 0.1.0 (2026-01-31)

- **Protocol**: `__requestIframe__` CURRENT bumped to `2` (minimum supported version remains `1`).
- **ACK**: `requireAck` flow generalized (auto-ack for delivery/received).
- **Stream**: Chunk-level `stream_pull/stream_ack` flow, `push/pull` modes, and `stream_start.mode` propagated to the read side.
- **Server**: `maxConcurrentRequestsPerClient` added to limit per-client in-flight requests (mitigate message explosion / DoS).

