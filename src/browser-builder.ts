import { chromium, firefox } from "playwright";
import { existsSync } from "fs";
import type { BrowserSession } from "./types.js";

/**
 * Returns the path to a locally installed Firefox binary on macOS or Linux.
 * Returns undefined if none of the known paths exist.
 */
function findLocalFirefoxPath(): string | undefined {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Firefox.app/Contents/MacOS/firefox",
          "/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox",
          "/Applications/FirefoxDeveloperEdition.app/Contents/MacOS/firefox",
          "/Applications/Firefox Nightly.app/Contents/MacOS/firefox",
        ]
      : [
          "/usr/bin/firefox",
          "/usr/bin/firefox-esr",
          "/usr/lib/firefox/firefox",
          "/usr/lib/firefox-esr/firefox-esr",
          "/snap/bin/firefox",
          "/usr/local/bin/firefox",
        ];

  return candidates.find((p) => existsSync(p));
}

/**
 * Returns the path to a locally installed Chromium/Chrome binary on macOS or Linux.
 * Used as a fallback when the 'chrome' channel is unavailable.
 */
function findLocalChromiumPath(): string | undefined {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium-browser",
          "/usr/bin/chromium",
          "/snap/bin/chromium",
          "/usr/local/bin/google-chrome",
          "/usr/local/bin/chromium",
        ];

  return candidates.find((p) => existsSync(p));
}

export async function buildBrowser(
  browser: "chrome" | "firefox",
  headless: boolean,
  width: number = 1280,
  height: number = 800
): Promise<BrowserSession> {
  let browserInstance;

  if (browser === "chrome") {
    // Try the 'chrome' channel first – Playwright resolves the system Chrome
    // installation automatically on both macOS and Linux without downloading
    // anything. Fall back to an explicit executablePath if needed.
    const executablePath = findLocalChromiumPath();
    try {
      browserInstance = await chromium.launch({
        channel: "chrome",
        headless,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    } catch {
      if (!executablePath) {
        throw new Error(
          "No local Chrome/Chromium installation found. " +
            "Please install Google Chrome or Chromium."
        );
      }
      browserInstance = await chromium.launch({
        executablePath,
        headless,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    }
  } else {
    const executablePath = findLocalFirefoxPath();
    if (!executablePath) {
      throw new Error(
        "No local Firefox installation found. " +
          "Please install Firefox."
      );
    }
    browserInstance = await firefox.launch({
      executablePath,
      headless,
    });
  }

  const context = await browserInstance.newContext({
    viewport: { width, height },
  });

  const page = await context.newPage();

  return {
    browser: browserInstance,
    context,
    page,
  };
}
