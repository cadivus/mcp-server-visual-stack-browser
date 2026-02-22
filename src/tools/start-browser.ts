import type { ToolResponse, BidiLogEntry } from "../types.js";
import { StartBrowserSchema } from "../schemas.js";
import { buildDriver } from "../browser-builder.js";
import { setSession } from "../session.js";
import { parseBidiJsError, parseBidiConsoleMessage, assignUniqueId } from "../bidi.js";

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
    const driver = await buildDriver(browser, headless, width, height);
    const sessionId = `${browser}-${Date.now()}`;

    // Set up BiDi-based log capture for real-time console + error collection
    const bidiStore: BidiLogEntry[] = [];
    setSession(sessionId, driver, bidiStore);

    const driverAny = driver as any;
    try {
      await driverAny.script().addJavaScriptErrorHandler((error: any) => {
        const entry = parseBidiJsError(error);
        const id = String(entry.timestamp);
        bidiStore.push({ ...entry, id: assignUniqueId(bidiStore, id) });
      });

      await driverAny.script().addConsoleMessageHandler((msg: any) => {
        const entry = parseBidiConsoleMessage(msg);
        const id = String(entry.timestamp);
        bidiStore.push({ ...entry, id: assignUniqueId(bidiStore, id) });
      });
    } catch {
      // BiDi handlers failed – log capture will be unavailable
    }

    // Navigate to initial URL if provided
    if (url) {
      await driver.get(url);
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
