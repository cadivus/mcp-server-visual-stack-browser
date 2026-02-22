import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { startBrowserTool, handleStartBrowser } from "./tools/start-browser.js";
import { executeJavascriptTool, handleExecuteJavascript } from "./tools/execute-js.js";
import {
  getConsoleLogsTool,
  getConsoleLogStacktraceTool,
  handleGetConsoleLogs,
  handleGetConsoleLogStacktrace,
} from "./tools/console-logs.js";
import { takeScreenshotTool, handleTakeScreenshot } from "./tools/screenshot.js";
import { clickAtCoordinatesTool, handleClickAtCoordinates } from "./tools/click.js";
import { scrollTool, handleScroll } from "./tools/scroll.js";

// ── MCP Server ────────────────────────────────────────────────────────────────
export const server = new Server(
  { name: "selenium-dev-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ── Tool catalogue ────────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    startBrowserTool,
    executeJavascriptTool,
    getConsoleLogsTool,
    getConsoleLogStacktraceTool,
    takeScreenshotTool,
    clickAtCoordinatesTool,
    scrollTool,
  ],
}));

// ── Tool dispatch ─────────────────────────────────────────────────────────────
const handlers: Record<string, (args: unknown) => Promise<any>> = {
  start_browser: handleStartBrowser,
  execute_javascript: handleExecuteJavascript,
  get_console_logs: handleGetConsoleLogs,
  get_console_log_stacktrace: handleGetConsoleLogStacktrace,
  take_screenshot: handleTakeScreenshot,
  click_at_coordinates: handleClickAtCoordinates,
  scroll: handleScroll,
};

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = handlers[name];

  if (!handler) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  }

  return handler(args);
});
