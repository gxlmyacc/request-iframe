import { 
  ServerRequest, ServerResponse, PostMessageData
} from '../types';
import { MessageContext } from '../message';

/**
 * ServerRequest implementation
 */
export class ServerRequestImpl implements ServerRequest {
  public body: any;
  public stream?: ServerRequest['stream'];
  public headers: Record<string, string>;
  public cookies: Record<string, string>;
  public path: string;
  public params: Record<string, string>;
  public requestId: string;
  public origin: string;
  public source: Window;
  public res: ServerResponse;

  constructor(
    data: PostMessageData,
    context: MessageContext,
    response: ServerResponse,
    params: Record<string, string> = {}
  ) {
    this.body = data.body;
    // headers may contain array values (e.g., Set-Cookie), simplified to string here
    this.headers = {};
    if (data.headers) {
      for (const [key, value] of Object.entries(data.headers)) {
        this.headers[key] = Array.isArray(value) ? value.join(', ') : value;
      }
    }
    this.cookies = data.cookies || {};
    this.path = data.path || '';
    this.params = params;
    this.requestId = data.requestId;
    this.origin = context.origin;
    this.source = context.source!;
    this.res = response;
  }
}
