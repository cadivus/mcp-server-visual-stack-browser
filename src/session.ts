import type { BrowserSession, LogEntry, Page } from "./types.js";

// ── Session stores ────────────────────────────────────────────────────────────
const sessions = new Map<string, BrowserSession>();
const sessionLogs = new Map<string, LogEntry[]>();

// ── Accessors ─────────────────────────────────────────────────────────────────
export function getPage(sessionId: string): Page | undefined {
  return sessions.get(sessionId)?.page;
}

export function getSession(sessionId: string): BrowserSession | undefined {
  return sessions.get(sessionId);
}

export function hasSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function setSession(
  sessionId: string,
  session: BrowserSession,
  logStore: LogEntry[]
): void {
  sessions.set(sessionId, session);
  sessionLogs.set(sessionId, logStore);
}

export function getLogs(sessionId: string): LogEntry[] {
  return sessionLogs.get(sessionId) || [];
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
export async function shutdown(): Promise<void> {
  for (const [id, session] of sessions) {
    try {
      await session.context.close();
      await session.browser.close();
    } catch {
      // best-effort
    }
    sessions.delete(id);
    sessionLogs.delete(id);
  }
}
