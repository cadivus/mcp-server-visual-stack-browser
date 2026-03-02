import type { ToolResponse } from "../types.js";
import { PressKeySchema } from "../schemas.js";
import { getPage } from "../session.js";

export const pressKeyTool = {
  name: "press_key",
  description:
    "Press a key or key combination. " +
    "Supports special keys like Enter, Backspace, Tab, Escape, ArrowUp, etc. " +
    "For key combinations, use '+' as separator: 'Control+c', 'Control+Shift+a', 'Meta+v' (Cmd on Mac). " +
    "Common keys: Enter, Backspace, Delete, Tab, Escape, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, " +
    "Home, End, PageUp, PageDown, F1-F12, Control, Shift, Alt, Meta. " +
    "For single printable characters, prefer type_text instead.",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "Session ID from start_browser.",
      },
      key: {
        type: "string",
        description:
          "The key or key combination to press. " +
          "Examples: 'Enter', 'Backspace', 'Tab', 'Escape', " +
          "'Control+a', 'Control+c', 'Control+v', 'Meta+a' (Cmd+A on Mac), " +
          "'Shift+ArrowRight', 'Control+Shift+k'. " +
          "Uses Playwright key names.",
      },
      count: {
        type: "number",
        description: "Number of times to press the key (default: 1).",
      },
    },
    required: ["session_id", "key"],
    additionalProperties: false,
  },
};

export async function handlePressKey(args: unknown): Promise<ToolResponse> {
  const parsed = PressKeySchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        { type: "text", text: `Invalid arguments: ${parsed.error.message}` },
      ],
    };
  }

  const { session_id, key, count } = parsed.data;

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
    for (let i = 0; i < count; i++) {
      await page.keyboard.press(key);
    }

    const countInfo = count > 1 ? ` (${count} times)` : "";
    return {
      content: [
        {
          type: "text",
          text: `Pressed key: ${key}${countInfo}`,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Failed to press key: ${message}` }],
    };
  }
}
