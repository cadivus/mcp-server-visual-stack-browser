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
import { ocrScreenshotTool, handleOcrScreenshot, ocrScreenshotSearchTool, handleOcrScreenshotSearch } from "./tools/ocr.js";
import { typeTextTool, handleTypeText } from "./tools/type-text.js";
import { pressKeyTool, handlePressKey } from "./tools/press-key.js";
import { navigateTool, handleNavigate } from "./tools/navigate.js";
import { getCurrentUrlTool, handleGetCurrentUrl } from "./tools/get-url.js";

// ── MCP Server ────────────────────────────────────────────────────────────────
export const server = new Server(
  { name: "playwright-dev-mcp", version: "1.0.0" },
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
    ocrScreenshotTool,
    ocrScreenshotSearchTool,
    typeTextTool,
    pressKeyTool,
    navigateTool,
    getCurrentUrlTool,
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
  ocr_screenshot: handleOcrScreenshot,
  ocr_screenshot_search: handleOcrScreenshotSearch,
  type_text: handleTypeText,
  press_key: handlePressKey,
  navigate: handleNavigate,
  get_current_url: handleGetCurrentUrl,
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
