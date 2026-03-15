# mcp-server-visual-stack-browser

A **Model Context Protocol (MCP)** server that gives LLMs and AI Agents the ability to navigate, interact with, and debug web applications visually and programmatically.

Built on top of **Playwright** and **Tesseract OCR**, this server bypasses the limitations of standard DOM-scraping by allowing agents to "see" the screen, click by exact (x,y) coordinates, and pull deep JavaScript execution context via stack traces.

It provides spatial text coordinates via OCR, allowing agents to interact with visual elements **without relying on expensive and slow vision-model screenshot analysis**.

---

## 🚀 Why this exists

Standard web-scraping and AI browser tools rely heavily on the DOM tree. But what happens when the DOM is empty, obfuscated, or when vision models are too expensive? `mcp-server-visual-stack-browser` is specifically designed for:

* **Cost-Efficient AI Browsing:** Get exact coordinates for text elements via lightweight OCR, entirely bypassing the high token costs and latency of sending full screenshots to vision models.
* **Canvas & WebGL Apps:** Games, maps, or complex visualizers where UI elements don't exist in the HTML.
* **Flutter for Web:** Applications rendered entirely on a canvas.
* **Complex SPAs & Legacy UIs:** Where standard CSS selectors fail or change dynamically.
* **Deep Debugging:** Correlating visual UI errors with underlying JavaScript console logs and stack traces.

---

## ✨ Core Capabilities

* **👁️ Visual Navigation (Zero-Vision Mode):** Perform OCR to find text bounding boxes and click via exact coordinates. No CSS selectors or expensive vision models required.
* **🐛 Deep Execution Tracing:** Capture console logs, intercept errors, and pull full JavaScript stack traces directly from the browser runtime.
* **🤖 Human-like Interaction:** Scroll natively, simulate real keystrokes with human-like delays, and execute arbitrary JS in the page context.

---

## 🛠️ Available MCP Tools

This server exposes the following tools via the MCP `ListTools` / `CallTool` API:

### Browser & Session Management

* `start_browser`: Launches a Chrome or Firefox session (headed or headless) and returns a session ID. Begins real-time capture of console logs and page errors.
* `Maps`: Navigates the browser to a URL. Supports waiting for specific load conditions (`load`, `DOMContentLoaded`, `networkidle`, `commit`).
* `get_current_url`: Returns the current page URL and title for the active session.

### Visual & OCR Interactivity

* `ocr_screenshot`: Runs Tesseract OCR on the current viewport. Returns the text alongside exact `(x, y)` coordinates and bounding boxes for text blocks. This allows the model to locate and interact with UI elements purely through text data, avoiding the need for expensive screenshot analysis.
* `ocr_screenshot_search`: Runs OCR to search for a specific "needle" string, returning exact matches with positional data ready for coordinate clicking.
* `take_screenshot`: Captures a PNG screenshot of the current viewport, returned as a base64 image blob (for when full visual analysis is actually needed).
* `click_at_coordinates`: Clicks a point in the viewport by `(x, y)`. Automatically handles scaling if the LLM is working from a resized/downscaled screenshot.

### Page Interaction

* `scroll`: Scrolls the viewport up, down, left, or right by a percentage. Returns current scroll state and whether further scrolling is possible.
* `type_text`: Simulates character-by-character typing into the currently focused element. Includes optional per-keystroke delays to emulate human behavior.
* `press_key`: Sends specific key presses or combinations (e.g., `Enter`, `Tab`, `Ctrl+V`).

### JavaScript & Debugging

* `execute_javascript`: Runs arbitrary JavaScript in the current page context. Fully supports async code (`await`).
* `get_console_logs`: Retrieves console log entries collected since the session started. Supports filtering by severity level (`ALL`, `DEBUG`, `INFO`, `WARNING`, `SEVERE`).
* `get_console_log_stacktrace`: Retrieves the deep execution stack trace for a specific log entry ID (powered by Chrome CDP).

---

## ⚙️ Installation & Quick Start

### Claude Desktop Configuration

To use this with Claude Desktop, add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "visual-stack-browser": {
      "command": "npx",
      "args": ["-y", "@cadivus/mcp-server-visual-stack-browser"]
    }
  }
}

```

---

## 🏷️ Keywords

`mcp`, `model-context-protocol`, `playwright`, `browser-automation`, `ocr`, `canvas-testing`, `webgl-automation`, `javascript-debugging`, `stack-trace`, `llm-tools`, `ai-agent`
