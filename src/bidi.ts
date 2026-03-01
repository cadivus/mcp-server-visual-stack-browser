import type { LogEntry } from "./types.js";
import type { ConsoleMessage } from "playwright";

/**
 * Parse a Playwright page error (uncaught exception) into a normalised log entry.
 */
export function parsePageError(error: Error): Omit<LogEntry, "id"> {
  let message = error.message || String(error);
  if (!message.startsWith("Uncaught ")) {
    message = "Uncaught " + message;
  }

  let stack = error.stack || null;

  // Normalize anonymous stack frames to include "(anonymous)" for consistency
  if (stack) {
    // Chrome anonymous frames: "    at http://..." → "    at (anonymous) (http://...)"
    stack = stack.replace(
      /^(\s+at )((?:https?|file):\/\/.+)$/gm,
      "$1(anonymous) ($2)"
    );
    // Playwright-normalised Firefox frames with empty name: "    at  (http://...)" → "    at (anonymous) (http://...)"
    stack = stack.replace(
      /^(\s+at)\s+(\((?:https?|file):\/\/.+\))$/gm,
      "$1 (anonymous) $2"
    );
    // Raw Firefox frames: "funcName@URL:line:col" → "    at funcName (URL:line:col)"
    //                     "@URL:line:col"         → "    at (anonymous) (URL:line:col)"
    stack = stack.replace(
      /^([^@\s]*)@((?:https?|file):\/\/.+)$/gm,
      (_match, fnName: string, location: string) => {
        const name = fnName || "(anonymous)";
        return `    at ${name} (${location})`;
      }
    );
  }

  return {
    timestamp: Date.now(),
    level: "SEVERE",
    type: "error",
    message,
    stack,
    hasStack: !!stack,
  };
}

/**
 * Parse a Playwright console message into a normalised log entry.
 */
export function parseConsoleMessage(msg: ConsoleMessage): Omit<LogEntry, "id"> {
  const levelMap: Record<string, string> = {
    error: "SEVERE",
    warn: "WARNING",
    warning: "WARNING",
    info: "INFO",
    debug: "DEBUG",
    log: "INFO",
    trace: "DEBUG",
    dir: "INFO",
    assert: "SEVERE",
  };
  const rawLevel = msg.type();
  const level = levelMap[rawLevel] || "INFO";
  const text = msg.text();
  const location = msg.location();

  // Build a stack-like string from the location if available
  let stack: string | null = null;
  if (level === "SEVERE" && location.url) {
    stack = `${text}\n    at ${location.url}:${location.lineNumber + 1}:${location.columnNumber + 1}`;
  }

  return {
    timestamp: Date.now(),
    level,
    type: "console",
    message: text,
    stack,
    hasStack: !!stack,
  };
}

/**
 * Generate a unique ID for a log entry.
 * Uses the timestamp string as base, appending _N on collision.
 */
export function assignUniqueId(
  store: LogEntry[],
  baseId: string
): string {
  const usedIds = new Set(store.map((e) => e.id));
  let id = baseId;
  let counter = 1;
  while (usedIds.has(id)) {
    id = `${baseId}_${counter++}`;
  }
  return id;
}
