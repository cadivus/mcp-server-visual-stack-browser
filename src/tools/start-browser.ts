import type { ToolResponse, LogEntry } from "../types.js";
import { StartBrowserSchema } from "../schemas.js";
import { buildBrowser } from "../browser-builder.js";
import { setSession } from "../session.js";
import { parsePageError, parseConsoleMessage, assignUniqueId } from "../bidi.js";

export const startBrowserTool = {
  name: "start_browser",
  description:
    "Launch a Chrome or Firefox browser session. " +
    "Returns a session ID used by subsequent browser tools.",
  inputSchema: {
    type: "object" as const,
    properties: {
      browser: {
        type: "string",
        enum: ["chrome", "firefox"],
        description: "Which browser to launch.",
      },
      headless: {
        type: "boolean",
        description: "Run the browser without a visible UI (default: false).",
      },
      width: {
        type: "number",
        description: "Window width in pixels (e.g. 1280).",
      },
      height: {
        type: "number",
        description: "Window height in pixels (e.g. 800).",
      },
      url: {
        type: "string",
        description: "Initial URL to navigate to after launching the browser.",
      },
    },
    required: ["browser"],
    additionalProperties: false,
  },
};

export async function handleStartBrowser(args: unknown): Promise<ToolResponse> {
  const parsed = StartBrowserSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
    };
  }

  const { browser, headless, width, height, url } = parsed.data;

  try {
    const session = await buildBrowser(browser, headless, width, height);
    const sessionId = `${browser}-${Date.now()}`;

    // Set up Playwright-based log capture for real-time console + error collection
    const logStore: LogEntry[] = [];
    setSession(sessionId, session, logStore);

    // Listen for console messages
    session.page.on("console", (msg) => {
      const entry = parseConsoleMessage(msg);
      const id = String(entry.timestamp);
      logStore.push({ ...entry, id: assignUniqueId(logStore, id) });
    });

    // Listen for uncaught page errors
    session.page.on("pageerror", (error) => {
      const entry = parsePageError(error);
      const id = String(entry.timestamp);
      logStore.push({ ...entry, id: assignUniqueId(logStore, id) });
    });

    // Navigate to initial URL if provided
    if (url) {
      await session.page.goto(url, { waitUntil: "load" });
    }

    const sizeInfo = width && height ? `, window size ${width}×${height}` : "";
    const modeInfo = headless ? "headless" : "headed";

    return {
      content: [
        {
          type: "text",
          text:
            `Started ${browser} (${modeInfo}${sizeInfo}).\n` +
            `Session ID: ${sessionId}`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Failed to start browser: ${message}` }],
    };
  }
}
