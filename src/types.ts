import type { Page, Browser, BrowserContext } from "playwright";

/** A normalised log entry captured via Playwright's console/pageerror events. */
export interface LogEntry {
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

/** A Playwright browser session with its associated resources. */
export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export type { Page, Browser, BrowserContext };
