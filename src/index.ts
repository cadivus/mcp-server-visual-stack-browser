#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Builder, WebDriver } from "selenium-webdriver";
import * as chrome from "selenium-webdriver/chrome.js";
import * as firefox from "selenium-webdriver/firefox.js";
import { z } from "zod";

// ── Session store ─────────────────────────────────────────────────────────────
const sessions = new Map<string, WebDriver>();

// ── Input schemas ─────────────────────────────────────────────────────────────
const StartBrowserSchema = z.object({
  browser: z.enum(["chrome", "firefox"]).describe("Browser to launch"),
  headless: z
    .boolean()
    .optional()
    .default(false)
    .describe("Run in headless mode (default: false)"),
  width: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Window width in pixels"),
  height: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Window height in pixels"),
});

// ── Server setup ──────────────────────────────────────────────────────────────
const server = new Server(
  { name: "selenium-dev-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ── Tool listing ──────────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "start_browser",
      description:
        "Launch a Chrome or Firefox browser session. " +
        "Returns a session ID used by subsequent browser tools.",
      inputSchema: {
        type: "object",
        properties: {
          browser: {
            type: "string",
            enum: ["chrome", "firefox"],
            description: "Which browser to launch.",
          },
          headless: {
            type: "boolean",
            description:
              "Run the browser without a visible UI (default: false).",
          },
          width: {
            type: "number",
            description: "Window width in pixels (e.g. 1280).",
          },
          height: {
            type: "number",
            description: "Window height in pixels (e.g. 800).",
          },
        },
        required: ["browser"],
        additionalProperties: false,
      },
    },
  ],
}));

// ── Tool execution ────────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "start_browser") {
    const parsed = StartBrowserSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Invalid arguments: ${parsed.error.message}`,
          },
        ],
      };
    }

    const { browser, headless, width, height } = parsed.data;

    try {
      const driver = await buildDriver(browser, headless, width, height);
      const sessionId = `${browser}-${Date.now()}`;
      sessions.set(sessionId, driver);

      const sizeInfo =
        width && height ? `, window size ${width}×${height}` : "";
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

  return {
    isError: true,
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
  };
});

// ── Browser builder ───────────────────────────────────────────────────────────
async function buildDriver(
  browser: "chrome" | "firefox",
  headless: boolean,
  width?: number,
  height?: number
): Promise<WebDriver> {
  if (browser === "chrome") {
    const opts = new chrome.Options();

    if (headless) {
      // --headless=new is the modern headless mode (Chrome 112+)
      opts.addArguments("--headless=new");
    }

    if (width && height) {
      // Works for both headless and headed Chrome
      opts.addArguments(`--window-size=${width},${height}`);
    }

    opts.addArguments("--no-sandbox", "--disable-dev-shm-usage");

    return new Builder().forBrowser("chrome").setChromeOptions(opts).build();
  }

  // Firefox
  const opts = new firefox.Options();

  if (headless) {
    opts.addArguments("-headless");
  }

  const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(opts)
    .build();

  if (width && height) {
    // setRect works for both headless and headed Firefox
    await driver.manage().window().setRect({ width, height });
  }

  return driver;
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown() {
  for (const [id, driver] of sessions) {
    try {
      await driver.quit();
    } catch {
      // best-effort
    }
    sessions.delete(id);
  }
}

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

// ── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
