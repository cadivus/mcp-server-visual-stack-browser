import type { ToolResponse } from "../types.js";
import { GetCurrentUrlSchema } from "../schemas.js";
import { getPage } from "../session.js";

export const getCurrentUrlTool = {
  name: "get_current_url",
  description:
    "Get the current URL of the browser page. " +
    "Returns the full URL including any query parameters and fragments.",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "Session ID from start_browser.",
      },
    },
    required: ["session_id"],
    additionalProperties: false,
  },
};

export async function handleGetCurrentUrl(
  args: unknown
): Promise<ToolResponse> {
  const parsed = GetCurrentUrlSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        { type: "text", text: `Invalid arguments: ${parsed.error.message}` },
      ],
    };
  }

  const { session_id } = parsed.data;

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
    const url = page.url();
    const title = await page.title();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ url, title }, null, 2),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Failed to get URL: ${message}` }],
    };
  }
}
