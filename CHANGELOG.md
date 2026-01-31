## Unreleased

- **Protocol**: `__requestIframe__` CURRENT bumped to `2` (minimum supported version remains `1`).
- **ACK**: `requireAck` is now handled more generically (auto-ack flow for delivery/received).
- **Stream**: Added chunk-level `stream_pull/stream_ack` flow, plus `push/pull` modes and `stream_start.mode` propagation to the read side.
- **Server**: Added `maxConcurrentRequestsPerClient` to limit per-client in-flight requests (mitigate message explosion / DoS).

