import type { ToolResponse } from "../types.js";
import { ClickAtCoordinatesSchema } from "../schemas.js";
import { getPage } from "../session.js";

export const clickAtCoordinatesTool = {
  name: "click_at_coordinates",
  description:
    "Click at (x, y) coordinates in the viewport. " +
    "Use take_screenshot first to visually locate the target element and determine its coordinates. " +
    "If coordinates were obtained from a resized screenshot, set " +
    "relative_by_width/height to the screenshot dimensions to map them back.",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "Session ID from start_browser.",
      },
      x: {
        type: "number",
        description: "X pixel coordinate.",
      },
      y: {
        type: "number",
        description: "Y pixel coordinate.",
      },
      relative_by_width: {
        type: "number",
        description: "Width of the resized screenshot the coordinates came from.",
      },
      relative_by_height: {
        type: "number",
        description: "Height of the resized screenshot the coordinates came from.",
      },
    },
    required: ["session_id", "x", "y"],
    additionalProperties: false,
  },
};

export async function handleClickAtCoordinates(
  args: unknown
): Promise<ToolResponse> {
  const parsed = ClickAtCoordinatesSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        { type: "text", text: `Invalid arguments: ${parsed.error.message}` },
      ],
    };
  }

  const {
    session_id,
    x,
    y,
    relative_by_width,
    relative_by_height,
  } = parsed.data;

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
    // Determine actual viewport size for scaling
    const viewport = page.viewportSize();
    const vpWidth = viewport?.width ?? 1280;
    const vpHeight = viewport?.height ?? 800;

    let targetX = x;
    let targetY = y;

    if (relative_by_width) {
      targetX = Math.round(x * (vpWidth / relative_by_width));
    }
    if (relative_by_height) {
      targetY = Math.round(y * (vpHeight / relative_by_height));
    }

    // Playwright's mouse.click uses viewport-relative coordinates directly
    await page.mouse.click(Math.round(targetX), Math.round(targetY));

    return {
      content: [
        {
          type: "text",
          text:
            `Clicked at (${Math.round(targetX)}, ${Math.round(targetY)})` +
            (relative_by_width || relative_by_height
              ? ` (scaled from (${x}, ${y}) relative to ${relative_by_width ?? vpWidth}×${relative_by_height ?? vpHeight}, ` +
                `actual viewport ${vpWidth}×${vpHeight})`
              : ` in viewport ${vpWidth}×${vpHeight}`),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `Click failed: ${message}` },
      ],
    };
  }
}
