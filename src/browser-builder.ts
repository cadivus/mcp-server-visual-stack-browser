import { chromium, firefox } from "playwright";
import { existsSync, readdirSync } from "fs";
import type { BrowserSession } from "./types.js";

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

function resolveLinuxDisplayEnv(env: NodeJS.ProcessEnv): void {
  const runtimeDir =
    env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 0}`;

  if (!env.XDG_RUNTIME_DIR) {
    env.XDG_RUNTIME_DIR = runtimeDir;
  }

  if (env.DISPLAY || env.WAYLAND_DISPLAY) return;

  if (process.env.XDG_SESSION_TYPE === "wayland") {
    env.WAYLAND_DISPLAY = "wayland-0";
  } else {
    try {
      const sock = readdirSync(runtimeDir).find((n) => n.startsWith("wayland-"));
      if (sock) env.WAYLAND_DISPLAY = sock;
    } catch {
      // no runtime dir available
    }
  }

  env.DISPLAY = ":0";
}

export async function buildBrowser(
  browser: "chrome" | "firefox",
  headless: boolean,
  width: number = 1280,
  height: number = 800
): Promise<BrowserSession> {
  let browserInstance;

  const browserEnv: NodeJS.ProcessEnv = { ...process.env };

  if (process.platform === "linux" && !headless) {
    resolveLinuxDisplayEnv(browserEnv);

    if (!browserEnv.DISPLAY && !browserEnv.WAYLAND_DISPLAY) {
      console.warn("no display server detected; switching to headless mode");
      headless = true;
    }
  }

  if (browser === "chrome") {
    const executablePath = findLocalChromiumPath();

    const chromeArgs = ["--disable-dev-shm-usage"];
    if (process.platform === "linux") {
      chromeArgs.push("--ozone-platform-hint=auto");
      if (browserEnv.WAYLAND_DISPLAY) {
        chromeArgs.push("--enable-features=UseOzonePlatform", "--ozone-platform=wayland");
      }
    }

    try {
      browserInstance = await chromium.launch({
        channel: "chrome",
        headless: headless,
        args: chromeArgs,
        env: browserEnv,
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
        headless: headless,
        args: chromeArgs,
        env: browserEnv,
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
      env: browserEnv,
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
