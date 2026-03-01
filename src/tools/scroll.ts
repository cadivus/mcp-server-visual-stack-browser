import type { ToolResponse } from "../types.js";
import { ScrollSchema } from "../schemas.js";
import { getPage } from "../session.js";

export const scrollTool = {
  name: "scroll",
  description:
    "Scroll the page up, down, left, or right by a percentage of the viewport size. " +
    "Returns whether further scrolling is possible in each direction.",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "Session ID returned by start_browser.",
      },
      direction: {
        type: "string",
        enum: ["up", "down", "left", "right"],
        description: "Direction to scroll: 'up', 'down', 'left', or 'right'.",
      },
      scroll_amount: {
        type: "number",
        description:
          "Percentage of the viewport size to scroll (1-100). Default: 70.",
      },
    },
    required: ["session_id", "direction"],
    additionalProperties: false,
  },
};

export async function handleScroll(args: unknown): Promise<ToolResponse> {
  const parsed = ScrollSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        { type: "text", text: `Invalid arguments: ${parsed.error.message}` },
      ],
    };
  }

  const { session_id, direction, scroll_amount } = parsed.data;

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
    const result = await page.evaluate(
      ([pct, dir]: [number, string]) => {
        const p = pct / 100;
        const isHorizontal = dir === 'left' || dir === 'right';
        const size = isHorizontal ? window.innerWidth : window.innerHeight;
        const delta = Math.round(size * p) * (dir === 'up' || dir === 'left' ? -1 : 1);
        window.scrollBy({
          top:  isHorizontal ? 0 : delta,
          left: isHorizontal ? delta : 0,
          behavior: 'instant' as ScrollBehavior
        });

        const scrollTop  = document.documentElement.scrollTop  || document.body.scrollTop;
        const scrollLeft = document.documentElement.scrollLeft || document.body.scrollLeft;
        const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
        const scrollWidth  = document.documentElement.scrollWidth  || document.body.scrollWidth;
        const clientHeight = document.documentElement.clientHeight || document.body.clientHeight;
        const clientWidth  = document.documentElement.clientWidth  || document.body.clientWidth;

        return {
          canScrollUp:    scrollTop  > 0,
          canScrollDown:  scrollTop  + clientHeight < scrollHeight - 1,
          canScrollLeft:  scrollLeft > 0,
          canScrollRight: scrollLeft + clientWidth  < scrollWidth  - 1,
          scrollTop:  Math.round(scrollTop),
          scrollLeft: Math.round(scrollLeft),
          scrollHeight, scrollWidth,
          clientHeight, clientWidth
        };
      },
      [scroll_amount, direction] as [number, string]
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              scrolled: direction,
              scroll_amount_pct: scroll_amount,
              can_scroll_up: result.canScrollUp,
              can_scroll_down: result.canScrollDown,
              can_scroll_left: result.canScrollLeft,
              can_scroll_right: result.canScrollRight,
              scroll_top: result.scrollTop,
              scroll_left: result.scrollLeft,
              page_height: result.scrollHeight,
              page_width: result.scrollWidth,
              viewport_height: result.clientHeight,
              viewport_width: result.clientWidth,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Scroll failed: ${message}` }],
    };
  }
}
