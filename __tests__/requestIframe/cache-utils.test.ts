import { setupRequestIframeTestEnv } from '../test-utils/request-iframe';

setupRequestIframeTestEnv();

describe('requestIframe - Cache utilities', () => {
  describe('Cache utilities', () => {
    it('should test server cache functions', () => {
      const { getCachedServer, cacheServer, removeCachedServer, clearServerCache } = require('../../src/utils/cache');
      const { requestIframeServer } = require('../../src/api/server');

      // Test getCachedServer with no id
      expect(getCachedServer('key1')).toBeNull();
      expect(getCachedServer(undefined, undefined)).toBeNull();

      // Test cacheServer with no id
      const server1 = requestIframeServer({ id: 'server1', secretKey: 'key1' });
      cacheServer(server1, 'key1', 'server1');

      // Test getCachedServer with id
      const cached = getCachedServer('key1', 'server1');
      expect(cached).toBe(server1);

      // Test removeCachedServer with no id
      removeCachedServer('key1'); // Should not throw
      removeCachedServer(undefined, undefined); // Should not throw

      // Test removeCachedServer with id
      removeCachedServer('key1', 'server1');
      expect(getCachedServer('key1', 'server1')).toBeNull();

      // Test clearServerCache
      const server2 = requestIframeServer({ id: 'server2', secretKey: 'key2' });
      cacheServer(server2, 'key2', 'server2');
      clearServerCache();
      expect(getCachedServer('key2', 'server2')).toBeNull();

      server1.destroy();
      server2.destroy();
    });

    it('should test clearMessageChannelCache', () => {
      const { clearMessageChannelCache, getOrCreateMessageChannel } = require('../../src/utils/cache');

      // Create a channel
      const channel1 = getOrCreateMessageChannel('test-key');
      expect(channel1).toBeDefined();

      // Clear cache
      clearMessageChannelCache();

      // Create another channel - should be new instance
      const channel2 = getOrCreateMessageChannel('test-key');
      expect(channel2).toBeDefined();

      channel1.release();
      channel2.release();
    });
  });
});

