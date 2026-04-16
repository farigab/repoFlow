import type { WebviewToExtensionMessage } from '../../src/shared/protocol';

declare global {
  interface Window {
    __REPOFLOW_ASSETS__?: {
      hero?: string;
    };
  }

  function acquireVsCodeApi(): {
    postMessage(message: WebviewToExtensionMessage): void;
    setState<T>(data: T): void;
    getState<T>(): T | undefined;
  };
}

export const vscode = acquireVsCodeApi();
