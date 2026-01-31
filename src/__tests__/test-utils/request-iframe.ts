import { clearRequestIframeClientCache } from '../../api/client';
import { clearRequestIframeServerCache } from '../../api/server';
import { clearMessageChannelCache } from '../../utils/cache';

/**
 * Setup a clean test environment for request-iframe integration tests.
 * - Clears caches
 * - Removes iframes from document
 */
export function setupRequestIframeTestEnv(): void {
  beforeEach(() => {
    clearRequestIframeClientCache();
    clearRequestIframeServerCache();
    clearMessageChannelCache();
    document.querySelectorAll('iframe').forEach((iframe) => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    });
  });

  afterEach(() => {
    clearRequestIframeClientCache();
    clearRequestIframeServerCache();
    clearMessageChannelCache();
    document.querySelectorAll('iframe').forEach((iframe) => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    });
  });
}

/**
 * Create test iframe
 */
export function createTestIframe(origin: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.src = `${origin}/test.html`;
  document.body.appendChild(iframe);
  return iframe;
}

/**
 * Cleanup test iframe
 */
export function cleanupIframe(iframe: HTMLIFrameElement): void {
  if (iframe.parentNode) {
    iframe.parentNode.removeChild(iframe);
  }
}

/**
 * Convert Blob to text (for assertions)
 */
export function blobToText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

