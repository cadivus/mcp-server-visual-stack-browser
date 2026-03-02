#!/usr/bin/env python3
"""
E2E tests for the type_text and press_key MCP tools.

Tests keyboard input functionality including:
- Typing text into a text input
- Typing text into a textarea
- Using Backspace to delete characters
- Using Ctrl+A to select all text
- Using key combinations (Ctrl+A, then Backspace to clear)
- Verifying typed text via OCR and via execute_javascript

Uses a local keyboard-test.html page with input fields.
"""

import asyncio
import json
import os
import sys
import socket
import threading
import argparse
from http.server import HTTPServer, SimpleHTTPRequestHandler

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


SERVER_SCRIPT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "dist",
    "index.js",
)


def find_free_port():
    """Find a free port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        s.listen(1)
        port = s.getsockname()[1]
    return port


def start_test_server(port, directory):
    """Start an HTTP server in a background thread."""
    os.chdir(directory)

    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

    server = HTTPServer(("localhost", port), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def extract_session_id(response_text: str) -> str:
    for line in response_text.splitlines():
        if "Session ID:" in line:
            return line.split("Session ID:")[-1].strip()
    raise ValueError(f"Could not extract session ID from: {response_text}")


async def call_tool(session: ClientSession, name: str, arguments: dict) -> str:
    print(f"\n{'='*60}")
    print(f">>> Calling tool: {name}")
    formatted_args = json.dumps(arguments, indent=2).replace("\\n", "\n")
    print(f"    Arguments: {formatted_args}")
    print(f"{'='*60}")

    result = await session.call_tool(name, arguments)
    texts = []
    for block in result.content:
        if hasattr(block, "text"):
            texts.append(block.text)
    combined = "\n".join(texts)
    print(combined)
    return combined


class TestResult:
    def __init__(self, name: str):
        self.name = name
        self.passed = False
        self.error = None

    def mark_pass(self):
        self.passed = True
        print(f"✅ {self.name} - PASSED")

    def mark_fail(self, error: str):
        self.passed = False
        self.error = error
        print(f"❌ {self.name} - FAILED: {error}")


async def get_input_value(session: ClientSession, session_id: str, element_id: str) -> str:
    """Helper to get the value of an input element via JS."""
    result = await call_tool(session, "execute_javascript", {
        "session_id": session_id,
        "script": f"return document.getElementById('{element_id}').value;",
    })
    return result.strip()


async def run_tests(session: ClientSession, session_id: str, target_url: str) -> list[TestResult]:
    results = []

    # Navigate to test page
    await call_tool(session, "navigate", {
        "session_id": session_id,
        "url": target_url,
    })
    await asyncio.sleep(1)

    # ── Test 1: Verify OCR works on the test page ────────────────────────────
    test = TestResult("OCR Verification on Keyboard Test Page")
    results.append(test)
    try:
        ocr_result = await call_tool(session, "ocr_screenshot", {
            "session_id": session_id,
        })
        if "Keyboard Input Test" in ocr_result:
            test.mark_pass()
        else:
            test.mark_fail(f"OCR did not find 'Keyboard Input Test' in page. Got: {ocr_result[:200]}")
    except Exception as e:
        test.mark_fail(str(e))

    # ── Test 2: Type text into input field ────────────────────────────────────
    test = TestResult("Type Text into Input Field")
    results.append(test)
    try:
        # Click on the text input to focus it
        await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "document.getElementById('text-input').focus();",
        })
        await asyncio.sleep(0.3)

        # Type some text
        await call_tool(session, "type_text", {
            "session_id": session_id,
            "text": "Hello World",
        })
        await asyncio.sleep(0.3)

        # Verify via JS
        value = await get_input_value(session, session_id, "text-input")
        if value == "Hello World":
            test.mark_pass()
        else:
            test.mark_fail(f"Expected 'Hello World', got: '{value}'")
    except Exception as e:
        test.mark_fail(str(e))

    # ── Test 3: Verify typed text via OCR ─────────────────────────────────────
    test = TestResult("Verify Typed Text via OCR")
    results.append(test)
    try:
        ocr_result = await call_tool(session, "ocr_screenshot", {
            "session_id": session_id,
        })
        if "Hello World" in ocr_result:
            test.mark_pass()
        else:
            test.mark_fail(f"OCR did not find 'Hello World'. Got: {ocr_result[:300]}")
    except Exception as e:
        test.mark_fail(str(e))

    # ── Test 4: Use Backspace to delete characters ────────────────────────────
    test = TestResult("Press Backspace to Delete Characters")
    results.append(test)
    try:
        # Press Backspace 6 times to delete " World"
        await call_tool(session, "press_key", {
            "session_id": session_id,
            "key": "Backspace",
            "count": 6,
        })
        await asyncio.sleep(0.3)

        value = await get_input_value(session, session_id, "text-input")
        if value == "Hello":
            test.mark_pass()
        else:
            test.mark_fail(f"Expected 'Hello', got: '{value}'")
    except Exception as e:
        test.mark_fail(str(e))

    # ── Test 5: Select all and delete (Ctrl+A / Meta+A, Backspace) ──────────
    test = TestResult("Select All and Delete (Meta+A, Backspace)")
    results.append(test)
    try:
        # Use Meta+a on macOS, Control+a on Linux/Windows
        # Playwright in headless Chrome on macOS responds to Meta+a for select-all
        import platform
        select_all_key = "Meta+a" if platform.system() == "Darwin" else "Control+a"

        # Select all text
        await call_tool(session, "press_key", {
            "session_id": session_id,
            "key": select_all_key,
        })
        await asyncio.sleep(0.2)

        # Delete selected text
        await call_tool(session, "press_key", {
            "session_id": session_id,
            "key": "Backspace",
        })
        await asyncio.sleep(0.2)

        value = await get_input_value(session, session_id, "text-input")
        if value == "":
            test.mark_pass()
        else:
            test.mark_fail(f"Expected empty string, got: '{value}'")
    except Exception as e:
        test.mark_fail(str(e))

    # ── Test 6: Type into textarea ────────────────────────────────────────────
    test = TestResult("Type Text into Textarea")
    results.append(test)
    try:
        # Click on textarea to focus
        await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "document.getElementById('textarea-input').focus();",
        })
        await asyncio.sleep(0.3)

        await call_tool(session, "type_text", {
            "session_id": session_id,
            "text": "Line 1",
        })
        # Press Enter to go to next line
        await call_tool(session, "press_key", {
            "session_id": session_id,
            "key": "Enter",
        })
        await call_tool(session, "type_text", {
            "session_id": session_id,
            "text": "Line 2",
        })
        await asyncio.sleep(0.3)

        value = await get_input_value(session, session_id, "textarea-input")
        if "Line 1" in value and "Line 2" in value:
            test.mark_pass()
        else:
            test.mark_fail(f"Expected 'Line 1\\nLine 2', got: '{value}'")
    except Exception as e:
        test.mark_fail(str(e))

    # ── Test 7: Tab key to switch focus ───────────────────────────────────────
    test = TestResult("Tab Key to Switch Focus")
    results.append(test)
    try:
        # Focus the text input first
        await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "document.getElementById('text-input').focus();",
        })
        await asyncio.sleep(0.2)

        # Type something so we know which field is focused
        await call_tool(session, "type_text", {
            "session_id": session_id,
            "text": "Before Tab",
        })
        await asyncio.sleep(0.2)

        # Press Tab to move to textarea
        await call_tool(session, "press_key", {
            "session_id": session_id,
            "key": "Tab",
        })
        await asyncio.sleep(0.2)

        # Verify focus moved by checking which element is active
        active_id = await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "return document.activeElement?.id || 'none';",
        })

        if "textarea-input" in active_id:
            test.mark_pass()
        else:
            test.mark_fail(f"Expected focus on 'textarea-input', got: '{active_id.strip()}'")
    except Exception as e:
        test.mark_fail(str(e))

    # ── Test 8: Type with delay ───────────────────────────────────────────────
    test = TestResult("Type with Delay")
    results.append(test)
    try:
        # Clear and focus input
        await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "document.getElementById('text-input').value = ''; document.getElementById('text-input').focus();",
        })
        await asyncio.sleep(0.2)

        await call_tool(session, "type_text", {
            "session_id": session_id,
            "text": "Slow",
            "delay": 50,
        })
        await asyncio.sleep(0.3)

        value = await get_input_value(session, session_id, "text-input")
        if value == "Slow":
            test.mark_pass()
        else:
            test.mark_fail(f"Expected 'Slow', got: '{value}'")
    except Exception as e:
        test.mark_fail(str(e))

    return results


async def main(browser: str) -> None:
    test_pages_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-pages")
    port = find_free_port()
    server = start_test_server(port, test_pages_dir)
    TARGET_URL = f"http://localhost:{port}/keyboard-test.html"

    print(f"Started local test server on port {port}")
    print(f"Serving directory: {test_pages_dir}")
    print(f"Browser: {browser}")
    print(f"Target URL: {TARGET_URL}\n")

    all_results = []

    try:
        server_params = StdioServerParameters(
            command="node",
            args=[SERVER_SCRIPT],
        )

        print(f"Starting MCP server: node {SERVER_SCRIPT}\n")

        async with stdio_client(server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()

                tools_result = await session.list_tools()
                print(f"Available tools ({len(tools_result.tools)}):")
                for tool in tools_result.tools:
                    print(f"  - {tool.name}: {tool.description[:80]}...")

                start_result = await call_tool(session, "start_browser", {
                    "browser": browser,
                    "headless": True,
                })
                session_id = extract_session_id(start_result)
                print(f"Extracted session ID: {session_id}")

                all_results = await run_tests(session, session_id, TARGET_URL)

    finally:
        print(f"\nShutting down local test server on port {port}...")
        server.shutdown()
        server.server_close()
        print("Test server stopped.")

    # Print test report
    print("\n" + "=" * 60)
    print("TEST REPORT")
    print("=" * 60)
    print(f"Browser: {browser}")
    print(f"Test URL: {TARGET_URL}")
    print(f"Test Page: keyboard-test.html")
    print("=" * 60)

    passed = [r for r in all_results if r.passed]
    failed = [r for r in all_results if not r.passed]

    print(f"\nTotal Tests: {len(all_results)}")
    print(f"Passed: {len(passed)}")
    print(f"Failed: {len(failed)}")

    if failed:
        print("\n❌ FAILED TESTS:")
        for t in failed:
            print(f"  • {t.name}")
            print(f"    Error: {t.error}")

    if passed:
        print("\n✅ PASSED TESTS:")
        for t in passed:
            print(f"  • {t.name}")

    print("\n" + "=" * 60)
    if not failed:
        print("RESULT: SUCCESS - All tests passed!")
    else:
        print(f"RESULT: FAILED - {len(failed)} test(s) failed")
    print("=" * 60)

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test keyboard input tools")
    parser.add_argument(
        "browser",
        choices=["chrome", "firefox"],
        help="Browser to use for testing",
    )
    args = parser.parse_args()
    asyncio.run(main(args.browser))
