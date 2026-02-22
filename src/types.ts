import type { WebDriver } from "selenium-webdriver";

/** A normalised log entry captured via the WebDriver BiDi protocol. */
export interface BidiLogEntry {
  id: string;
  timestamp: number;
  level: string;
  type: "console" | "error";
  message: string;
  stack: string | null;
  hasStack: boolean;
}

/** The shape every tool handler must return (matches MCP CallToolResult). */
export interface ToolResponse {
  isError?: boolean;
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
}

/** Re-export WebDriver so tool modules don't need to import selenium directly. */
export type { WebDriver };
