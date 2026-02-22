import { Actions, Origin } from "selenium-webdriver";
import type { ToolResponse } from "../types.js";
import { ClickAtCoordinatesSchema } from "../schemas.js";
import { getDriver } from "../session.js";

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

  const driver = getDriver(session_id);
  if (!driver) {
    return {
      isError: true,
      content: [
        { type: "text", text: `No session found with ID: ${session_id}` },
      ],
    };
  }

  try {
    // Determine actual viewport size for scaling
    const viewport = (await driver.executeScript(
      "return { width: window.innerWidth, height: window.innerHeight };"
    )) as { width: number; height: number };

    let targetX = x;
    let targetY = y;

    if (relative_by_width) {
      targetX = Math.round(x * (viewport.width / relative_by_width));
    }
    if (relative_by_height) {
      targetY = Math.round(y * (viewport.height / relative_by_height));
    }

    // Use Selenium Actions API to move to viewport coordinates and click.
    // Origin.VIEWPORT makes the offset relative to the top-left of the viewport.
    await driver
      .actions({ bridge: false })
      .move({ x: Math.round(targetX), y: Math.round(targetY), origin: Origin.VIEWPORT })
      .click()
      .perform();

    return {
      content: [
        {
          type: "text",
          text:
            `Clicked at (${Math.round(targetX)}, ${Math.round(targetY)})` +
            (relative_by_width || relative_by_height
              ? ` (scaled from (${x}, ${y}) relative to ${relative_by_width ?? viewport.width}×${relative_by_height ?? viewport.height}, ` +
                `actual viewport ${viewport.width}×${viewport.height})`
              : ` in viewport ${viewport.width}×${viewport.height}`),
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
