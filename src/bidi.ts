import type { BidiLogEntry } from "./types.js";

/**
 * Parse a BiDi JavaScript error into a normalised log entry.
 *
 * BiDi error objects use underscore-prefixed properties:
 *   _text, _level, _timeStamp, _stackTrace { callFrames }, _type
 */
export function parseBidiJsError(error: any): Omit<BidiLogEntry, "id"> {
  let message: string = error._text || error.message || String(error);
  const timestamp: number = error._timeStamp || Date.now();

  if (!message.startsWith("Uncaught ")) {
    message = "Uncaught " + message;
  }

  let stack: string | null = null;
  const stackTrace = error._stackTrace || error.stackTrace;
  if (stackTrace && stackTrace.callFrames) {
    const lines = [message];
    for (const frame of stackTrace.callFrames) {
      const fnName = frame.functionName || "(anonymous)";
      lines.push(
        `    at ${fnName} (${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1})`
      );
    }
    stack = lines.join("\n");
  } else if (error.stack) {
    stack = error.stack;
  }

  return {
    timestamp,
    level: "SEVERE",
    type: "error",
    message,
    stack,
    hasStack: !!stack,
  };
}

/**
 * Parse a BiDi console message into a normalised log entry.
 */
export function parseBidiConsoleMessage(entry: any): Omit<BidiLogEntry, "id"> {
  const levelMap: Record<string, string> = {
    error: "SEVERE",
    warn: "WARNING",
    warning: "WARNING",
    info: "INFO",
    debug: "DEBUG",
    log: "INFO",
  };
  const rawLevel: string = entry._level || entry.level || entry.type || "info";
  const level = levelMap[rawLevel] || "INFO";
  const text: string =
    entry._text ||
    entry.text ||
    (entry.args
      ? entry.args
          .map((a: any) => (a.value != null ? String(a.value) : String(a)))
          .join(" ")
      : String(entry));
  const timestamp: number = entry._timeStamp || entry.timeStamp || Date.now();

  return {
    timestamp,
    level,
    type: "console",
    message: text,
    stack: null,
    hasStack: false,
  };
}

/**
 * Generate a unique ID for a log entry.
 * Uses the timestamp string as base, appending _N on collision.
 */
export function assignUniqueId(
  store: BidiLogEntry[],
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
