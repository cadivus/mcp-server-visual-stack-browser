import { z } from "zod";

export const StartBrowserSchema = z.object({
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
  url: z
    .string()
    .url()
    .optional()
    .describe("Initial URL to navigate to after launching the browser"),
});

export const ExecuteJsSchema = z.object({
  session_id: z.string().describe("Session ID returned by start_browser"),
  script: z.string().describe("JavaScript code to execute in the page context"),
  async: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Wrap the script in an async function so you can use await (default: false)"
    ),
  args: z
    .array(z.unknown())
    .optional()
    .default([])
    .describe("Extra arguments forwarded to the script via the arguments array"),
});

export const GetConsoleLogsSchema = z.object({
  session_id: z.string().describe("Session ID returned by start_browser"),
  level: z
    .enum(["ALL", "DEBUG", "INFO", "WARNING", "SEVERE"])
    .optional()
    .describe("Minimum log level to include (default: ALL)"),
});

export const GetConsoleLogStacktraceSchema = z.object({
  session_id: z.string().describe("Session ID returned by start_browser"),
  log_id: z.string().describe("Log entry ID returned by get_console_logs"),
});

export const TakeScreenshotSchema = z.object({
  session_id: z.string().describe("Session ID returned by start_browser"),
});

export const ClickAtCoordinatesSchema = z.object({
  session_id: z.string().describe("Session ID from start_browser"),
  x: z.number().describe("X pixel coordinate"),
  y: z.number().describe("Y pixel coordinate"),
  relative_by_width: z
    .number()
    .positive()
    .optional()
    .describe("Width of the resized screenshot the coordinates came from"),
  relative_by_height: z
    .number()
    .positive()
    .optional()
    .describe("Height of the resized screenshot the coordinates came from"),
});

export const OcrScreenshotSchema = z.object({
  session_id: z.string().describe("Session ID returned by start_browser"),
  lang: z
    .string()
    .optional()
    .default("eng")
    .describe("Tesseract language code(s), e.g. 'eng', 'deu', 'eng+deu' (default: 'eng')"),
  blocks: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "false (default) = plain text string. " +
      "true = JSON array of spatially grouped phrases: [{ text, center_x, center_y, is_likely_button? }] — " +
      "center_x/center_y are ready to pass to click_at_coordinates. " +
      "is_likely_button field is only present when true. " +
      "Good for isolating buttons, labels, links."
    ),
});

export const OcrScreenshotSearchSchema = z.object({
  session_id: z.string().describe("Session ID returned by start_browser"),
  needle: z.string().describe("Case-insensitive substring to search for, e.g. 'akzeptieren' or 'Sign in'."),
  lang: z
    .string()
    .optional()
    .default("eng")
    .describe("Tesseract language code(s), e.g. 'eng', 'deu', 'eng+deu' (default: 'eng')"),
});

export const ScrollSchema = z.object({
  session_id: z.string().describe("Session ID returned by start_browser"),
  direction: z
    .enum(["up", "down", "left", "right"])
    .describe("Direction to scroll: 'up', 'down', 'left', or 'right'"),
  scroll_amount: z
    .number()
    .positive()
    .max(100)
    .optional()
    .default(70)
    .describe(
      "Percentage of the viewport height to scroll (1-100, default: 70)"
    ),
});
