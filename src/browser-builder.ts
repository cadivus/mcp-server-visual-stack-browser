import { chromium, firefox } from "playwright";
import type { BrowserSession } from "./types.js";

export async function buildBrowser(
  browser: "chrome" | "firefox",
  headless: boolean,
  width: number = 1280,
  height: number = 800
): Promise<BrowserSession> {
  const launcher = browser === "chrome" ? chromium : firefox;

  const browserInstance = await launcher.launch({
    headless,
    ...(browser === "chrome"
      ? { args: ["--no-sandbox", "--disable-dev-shm-usage"] }
      : {}),
  });

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
