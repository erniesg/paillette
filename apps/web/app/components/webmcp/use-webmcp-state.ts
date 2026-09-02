import { useSyncExternalStore } from 'react';
import {
  getWebMcpServerState,
  getWebMcpState,
  subscribeWebMcpState,
  type WebMcpState,
} from '~/lib/webmcp/store';

/**
 * Subscribes a component to the shared canvas. The store lives outside React
 * because its writers are WebMCP `execute` calls arriving from the host, not
 * React events — `useSyncExternalStore` is exactly the bridge for that.
 */
export const useWebMcpState = (): WebMcpState =>
  useSyncExternalStore(
    subscribeWebMcpState,
    getWebMcpState,
    getWebMcpServerState
  );
