import { OriginConstant } from '../constants';

/**
 * Derive targetOrigin from iframe.src
 */
export function getIframeTargetOrigin(iframe: HTMLIFrameElement): string {
  if (!iframe.src) {
    return OriginConstant.ANY;
  }
  try {
    return new URL(iframe.src).origin;
  } catch (e) {
    return OriginConstant.ANY;
  }
}

