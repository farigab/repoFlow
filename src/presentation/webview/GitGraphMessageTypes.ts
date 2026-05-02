import type { WebviewToExtensionMessage } from '../../shared/protocol';

export type MessageType = WebviewToExtensionMessage['type'];

export type PayloadFor<T extends MessageType> =
  Extract<WebviewToExtensionMessage, { type: T }> extends { payload: infer P }
    ? P
    : undefined;

export type MessageHandlerMap = Partial<{
  [K in MessageType]: (payload: PayloadFor<K>) => Promise<void>;
}>;
