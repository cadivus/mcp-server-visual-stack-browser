import type { ToolResponse } from "../types.js";
import { TakeScreenshotSchema } from "../schemas.js";
import { getPage } from "../session.js";

export const takeScreenshotTool = {
  name: "take_screenshot",
  description:
    "Returns the current page as a PNG image blob for visual inspection. " +
    "Use only when you need to analyse layout, images, or visual structure. " +
    "For reading text or locating text buttons use ocr_screenshot instead — it is faster and costs no vision tokens.",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "Session ID returned by start_browser.",
      },
    },
    required: ["session_id"],
    additionalProperties: false,
  },
};

export async function handleTakeScreenshot(args: unknown): Promise<ToolResponse> {
  const parsed = TakeScreenshotSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
    };
  }

  const { session_id } = parsed.data;
  const page = getPage(session_id);
  if (!page) {
    return {
      isError: true,
      content: [{ type: "text", text: `No session found with ID: ${session_id}` }],
    };
  }

  try {
    // Playwright returns a Buffer directly from screenshot()
    const buffer = await page.screenshot({ type: "png" });
    const base64 = buffer.toString("base64");
    return {
      content: [
        {
          type: "image",
          data: base64,
          mimeType: "image/png",
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Failed to take screenshot: ${message}` }],
    };
  }
}
