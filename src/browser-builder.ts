import { Builder, WebDriver } from "selenium-webdriver";
import * as chrome from "selenium-webdriver/chrome.js";
import * as firefox from "selenium-webdriver/firefox.js";

/**
 * Adjusts the window size so that the viewport matches the desired dimensions.
 * The viewport is the actual content area, excluding browser chrome (header bar, etc.)
 */
async function setViewportSize(
  driver: WebDriver,
  targetWidth: number,
  targetHeight: number
): Promise<void> {
  // Get current window and viewport sizes
  const windowRect = await driver.manage().window().getRect();

  const viewportSize = await driver.executeScript<{ width: number; height: number }>(
    "return { width: window.innerWidth, height: window.innerHeight };"
  );

  // Calculate the chrome (borders, toolbars, etc.)
  const chromeWidth = windowRect.width - viewportSize.width;
  const chromeHeight = windowRect.height - viewportSize.height;

  // Set window size to achieve desired viewport size
  await driver
    .manage()
    .window()
    .setRect({
      width: targetWidth + chromeWidth,
      height: targetHeight + chromeHeight,
    });
}

export async function buildDriver(
  browser: "chrome" | "firefox",
  headless: boolean,
  width: number = 1280,
  height: number = 800
): Promise<WebDriver> {
  if (browser === "chrome") {
    const opts = new chrome.Options();

    // Enable BiDi protocol for real-time log capture with stack traces
    (opts as any).enableBidi();

    if (headless) {
      opts.addArguments("--headless=new");
    }

    // Set initial window size (will be adjusted for viewport later)
    if (width && height) {
      opts.addArguments(`--window-size=${width},${height}`);
    }

    opts.addArguments("--no-sandbox", "--disable-dev-shm-usage");

    const driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(opts)
      .build();

    // Adjust window size to achieve desired viewport size
    if (width && height) {
      await setViewportSize(driver, width, height);
    }

    return driver;
  }

  // Firefox
  const opts = new firefox.Options();

  // Enable BiDi protocol for real-time log capture with stack traces
  (opts as any).enableBidi();

  if (headless) {
    opts.addArguments("-headless");
  }

  // Set initial window size (will be adjusted for viewport later)
  if (width && height) {
    opts.addArguments(`-width`, `${width}`, `-height`, `${height}`);
  }

  const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(opts)
    .build();

  // Adjust window size to achieve desired viewport size
  if (width && height) {
    await setViewportSize(driver, width, height);
  }

  return driver;
}
