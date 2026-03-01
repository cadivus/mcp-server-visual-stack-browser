import type { ToolResponse } from "../types.js";
import { GetConsoleLogsSchema, GetConsoleLogStacktraceSchema } from "../schemas.js";
import { hasSession, getLogs } from "../session.js";

// NOTE: Playwright captures console messages and page errors natively via
// page.on('console') and page.on('pageerror'). No BiDi or CDP needed.

export const getConsoleLogsTool = {
  name: "get_console_logs",
  description:
    "Fetch browser console log entries accumulated since the session started. " +
    "Each entry has a unique time-based ID (unix timestamp in ms). " +
    "Use get_console_log_stacktrace to retrieve the stack trace for a specific entry.",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "Session ID returned by start_browser.",
      },
      level: {
        type: "string",
        enum: ["ALL", "DEBUG", "INFO", "WARNING", "SEVERE"],
        description: "Minimum severity level to include (default: ALL).",
      },
    },
    required: ["session_id"],
    additionalProperties: false,
  },
};

export const getConsoleLogStacktraceTool = {
  name: "get_console_log_stacktrace",
  description:
    "Get the stack trace for a specific browser console log entry by its ID. " +
    "Only available for entries that include CDP stack trace data (Chrome).",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "Session ID returned by start_browser.",
      },
      log_id: {
        type: "string",
        description: "Log entry ID returned by get_console_logs.",
      },
    },
    required: ["session_id", "log_id"],
    additionalProperties: false,
  },
};

export async function handleGetConsoleLogs(args: unknown): Promise<ToolResponse> {
  const parsed = GetConsoleLogsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
    };
  }

  const { session_id, level } = parsed.data;
  if (!hasSession(session_id)) {
    return {
      isError: true,
      content: [{ type: "text", text: `No session found with ID: ${session_id}` }],
    };
  }

  try {
    const store = getLogs(session_id);

    const levelValues: Record<string, number> = {
      DEBUG: 700,
      INFO: 800,
      WARNING: 900,
      SEVERE: 1000,
    };
    const minValue =
      level && level !== "ALL" ? (levelValues[level] ?? 0) : 0;
    const filtered = store.filter(
      (e) => (levelValues[e.level] ?? 800) >= minValue
    );

    if (filtered.length === 0) {
      return { content: [{ type: "text", text: "No console log entries found." }] };
    }

    const lines = filtered.map(
      (e) =>
        `[${e.id}] ${e.level.padEnd(7)} ${new Date(e.timestamp).toISOString()}  ${e.message}`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Failed to get console logs: ${message}` }],
    };
  }
}

export async function handleGetConsoleLogStacktrace(args: unknown): Promise<ToolResponse> {
  const parsed = GetConsoleLogStacktraceSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
    };
  }

  const { session_id, log_id } = parsed.data;
  const store = getLogs(session_id);
  if (store.length === 0) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `No logs found for session: ${session_id}. Call get_console_logs first.`,
        },
      ],
    };
  }

  const entry = store.find((e) => e.id === log_id);
  if (!entry) {
    return {
      isError: true,
      content: [{ type: "text", text: `No log entry found with ID: ${log_id}` }],
    };
  }

  if (!entry.stack) {
    return {
      content: [
        {
          type: "text",
          text: `No stack trace available for log entry ${log_id}.\nMessage: ${entry.message}`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `Stack trace for [${log_id}] ${entry.level} — ${entry.message}\n\n${entry.stack}`,
      },
    ],
  };
}
