import type { ToolResponse } from "../types.js";
import { TypeTextSchema } from "../schemas.js";
import { getPage } from "../session.js";

export const typeTextTool = {
  name: "type_text",
  description:
    "Type a string of text into the currently focused element. " +
    "This simulates real keypresses one character at a time. " +
    "Make sure the target element is focused first (e.g. by clicking on it).",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "Session ID from start_browser.",
      },
      text: {
        type: "string",
        description: "The text string to type.",
      },
      delay: {
        type: "number",
        description:
          "Delay between key presses in milliseconds (default: 0). " +
          "Use a small delay (e.g. 50) to simulate human-like typing.",
      },
    },
    required: ["session_id", "text"],
    additionalProperties: false,
  },
};

export async function handleTypeText(args: unknown): Promise<ToolResponse> {
  const parsed = TypeTextSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        { type: "text", text: `Invalid arguments: ${parsed.error.message}` },
      ],
    };
  }

  const { session_id, text, delay } = parsed.data;

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
    await page.keyboard.type(text, { delay });

    return {
      content: [
        {
          type: "text",
          text: `Typed ${text.length} character(s): "${text.length > 100 ? text.slice(0, 100) + "…" : text}"`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Failed to type text: ${message}` }],
    };
  }
}
