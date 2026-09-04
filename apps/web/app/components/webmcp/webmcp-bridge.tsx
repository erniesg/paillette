/**
 * Mounts the WebMCP surface. Rendered once from `root.tsx`, so tools are
 * available on every route and survive client-side navigation.
 *
 * Everything downstream feature-detects, so on a browser without WebMCP this
 * component installs nothing, renders nothing, and costs a single `in` check.
 */

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from '@remix-run/react';
import { AgentActivityPanel } from './agent-activity-panel';
import { ensureWebMcpDebugHarness } from '~/lib/webmcp/debug-harness';
import {
  observePublicSearchResponses,
  readPageContext,
} from '~/lib/webmcp/observe-page';
import { isWebMcpAvailable, registerTools } from '~/lib/webmcp/registry';
import {
  setBridgeAttached,
  setPageContext,
  settleActivity,
  startActivity,
} from '~/lib/webmcp/store';
import { previewJson, shapedError } from '~/lib/webmcp/activity-format';
import { summariseToolResult } from '~/lib/webmcp/summarise';
import { createPailletteTools } from '~/lib/webmcp/tools';
import { installTurnBridge } from '~/lib/webmcp/turn-bridge';

// Before any component renders, so nothing that checks for a host in its own
// mount effect can look too early. See `ensureWebMcpDebugHarness`.
ensureWebMcpDebugHarness();

export function WebMcpBridge() {
  const location = useLocation();
  const navigate = useNavigate();

  // Refs, not deps: the tool set must be registered exactly once, but the
  // tools still need the *current* navigate and page context when they run.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const pageRef = useRef(readPageContext(location));
  pageRef.current = readPageContext(location);

  useEffect(() => {
    setPageContext(readPageContext(location));
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!isWebMcpAvailable()) {
      // No host. Do not patch fetch, do not register, do not render.
      return;
    }

    // Activity ids are opaque to the registry; remember which tool each one
    // belongs to so the summary can be shaped per tool.
    const toolNameByActivityId = new Map<string, string>();
    const disposeObserver = observePublicSearchResponses();
    // Installed after the observer and disposed before it, so the two fetch
    // wrappers unwind in the order they were laid down.
    const disposeTurnBridge = installTurnBridge();
    const disposeTools = registerTools(
      createPailletteTools({
        navigate: (to, options) => navigateRef.current(to, options),
        getPageContext: () => pageRef.current,
      }),
      {
        onError: (error, { toolName }) => {
          // Never throw into render; a failed tool must not break the page.
          console.warn(
            `[webmcp] ${toolName ? `${toolName}: ` : ''}${error.message}`
          );
        },
        onExecute: {
          onStart: ({ toolName, input }) => {
            const id = startActivity(toolName, input);
            toolNameByActivityId.set(id, toolName);
            return id;
          },
          onSettle: (id, outcome) => {
            const toolName = toolNameByActivityId.get(id) ?? '';
            toolNameByActivityId.delete(id);
            if (outcome.status === 'ok') {
              // `ok` here means `execute` returned rather than threw. The tools
              // answer refusals — a stale id, an exhausted collection — as a
              // returned `{ok:false}`, so the payload is what decides whether
              // this reads as an error, not the absence of an exception.
              settleActivity(
                id,
                'ok',
                summariseToolResult(toolName, outcome.result),
                {
                  detail: previewJson(outcome.result),
                  error: shapedError(outcome.result),
                }
              );
              return;
            }
            if (outcome.status === 'error') {
              settleActivity(id, 'error', outcome.message, {
                error: outcome.message,
              });
              return;
            }
            settleActivity(id, outcome.status, 'cancelled');
          },
        },
      }
    );

    setBridgeAttached(true);

    return () => {
      disposeTools();
      disposeTurnBridge();
      disposeObserver();
      setBridgeAttached(false);
    };
    // Mount-once: registration is global to the document, not to a render.
  }, []);

  return <AgentActivityPanel />;
}
