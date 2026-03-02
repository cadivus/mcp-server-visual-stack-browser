import type { ToolResponse } from "../types.js";
import { NavigateSchema } from "../schemas.js";
import { getPage } from "../session.js";

export const navigateTool = {
  name: "navigate",
  description:
    "Navigate the browser to a URL. " +
    "Waits for the page to finish loading before returning.",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "Session ID from start_browser.",
      },
      url: {
        type: "string",
        description: "The URL to navigate to.",
      },
      wait_until: {
        type: "string",
        enum: ["load", "domcontentloaded", "networkidle", "commit"],
        description:
          "When to consider the navigation complete (default: 'load'). " +
          "'load' waits for the load event. " +
          "'domcontentloaded' waits for DOMContentLoaded. " +
          "'networkidle' waits until no network connections for 500ms. " +
          "'commit' waits for the network response to be received.",
      },
    },
    required: ["session_id", "url"],
    additionalProperties: false,
  },
};

export async function handleNavigate(args: unknown): Promise<ToolResponse> {
  const parsed = NavigateSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        { type: "text", text: `Invalid arguments: ${parsed.error.message}` },
      ],
    };
  }

  const { session_id, url, wait_until } = parsed.data;

  const page = getPage(session_id);
  if (!page) {
    return {
      isError: true,
      content: [
        { type: "text", text: `No session found with ID: ${session_id}` },
      ],
    };
  }

  try {
    const response = await page.goto(url, { waitUntil: wait_until });
    const status = response?.status() ?? "unknown";
    const finalUrl = page.url();

    return {
      content: [
        {
          type: "text",
          text:
            `Navigated to: ${finalUrl}\n` +
            `Status: ${status}`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Failed to navigate: ${message}` }],
    };
  }
}
