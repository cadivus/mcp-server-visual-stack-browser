import type { WebDriver, BidiLogEntry } from "./types.js";

// ── Session stores ────────────────────────────────────────────────────────────
const sessions = new Map<string, WebDriver>();
const sessionLogs = new Map<string, BidiLogEntry[]>();

// ── Accessors ─────────────────────────────────────────────────────────────────
export function getDriver(sessionId: string): WebDriver | undefined {
  return sessions.get(sessionId);
}

export function hasSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function setSession(
  sessionId: string,
  driver: WebDriver,
  logStore: BidiLogEntry[]
): void {
  sessions.set(sessionId, driver);
  sessionLogs.set(sessionId, logStore);
}

export function getLogs(sessionId: string): BidiLogEntry[] {
  return sessionLogs.get(sessionId) || [];
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
export async function shutdown(): Promise<void> {
  for (const [id, driver] of sessions) {
    try {
      await driver.quit();
    } catch {
      // best-effort
    }
    sessions.delete(id);
    sessionLogs.delete(id);
  }
}
