#!/usr/bin/env python3
"""
E2E tests for the navigate and get_current_url MCP tools.

Tests navigation functionality including:
- Navigate to a URL and verify
- Get current URL and title
- Navigate to page with query parameters
- Click a link, then get the new URL
- Start browser with initial URL parameter
- Navigate between pages and verify URL changes

Uses a local navigation-test.html page with self-referencing links.
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
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        s.listen(1)
        port = s.getsockname()[1]
    return port


def start_test_server(port, directory):
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


async def run_tests(session: ClientSession, session_id: str, base_url: str, port: int) -> list[TestResult]:
    results = []

    # ── Test 1: Navigate to URL ──────────────────────────────────────────────
    test = TestResult("Navigate to URL")
    results.append(test)
    try:
        nav_result = await call_tool(session, "navigate", {
            "session_id": session_id,
            "url": base_url,
        })
        if "Navigated to:" in nav_result and "Status: 200" in nav_result:
            test.mark_pass()
        else:
            test.mark_fail(f"Unexpected navigate response: {nav_result}")
    except Exception as e:
        test.mark_fail(str(e))

    # ── Test 2: Get current URL ──────────────────────────────────────────────
    test = TestResult("Get Current URL")
    results.append(test)
    try:
        url_result = await call_tool(session, "get_current_url", {
            "session_id": session_id,
        })
        data = json.loads(url_result)
        if "navigation-test.html" in data.get("url", ""):
            if data.get("title") == "Navigation Test":
                test.mark_pass()
            else:
                test.mark_fail(f"Expected title 'Navigation Test', got: '{data.get('title')}'")
        else:
            test.mark_fail(f"Expected URL containing 'navigation-test.html', got: '{data.get('url')}'")
    except Exception as e:
        test.mark_fail(str(e))

    # ── Test 3: Navigate with query parameters ───────────────────────────────
    test = TestResult("Navigate with Query Parameters")
    results.append(test)
    try:
        url_with_params = f"{base_url}?page=2&source=test"
        await call_tool(session, "navigate", {
            "session_id": session_id,
            "url": url_with_params,
        })
        await asyncio.sleep(0.5)

        url_result = await call_tool(session, "get_current_url", {
            "session_id": session_id,
        })
        data = json.loads(url_result)
        url = data.get("url", "")
        if "page=2" in url and "source=test" in url:
            test.mark_pass()
        else:
            test.mark_fail(f"Expected URL with query params, got: '{url}'")
    except Exception as e:
        test.mark_fail(str(e))

    # ── Test 4: Click a link and verify URL changes ──────────────────────────
    test = TestResult("Click Link and Verify URL Change")
    results.append(test)
    try:
        # First navigate to the base page (no params)
        await call_tool(session, "navigate", {
            "session_id": session_id,
            "url": base_url,
        })
        await asyncio.sleep(0.5)

        # Click the link to page 3 using JS
        await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "document.getElementById('link-page3').click();",
        })
        await asyncio.sleep(1)

        url_result = await call_tool(session, "get_current_url", {
            "session_id": session_id,
        })
        data = json.loads(url_result)
        url = data.get("url", "")
        if "page=3" in url and "foo=bar" in url and "baz=qux" in url:
            test.mark_pass()
        else:
            test.mark_fail(f"Expected URL with page=3&foo=bar&baz=qux, got: '{url}'")
    except Exception as e:
        test.mark_fail(str(e))

    # ── Test 5: Navigate to different page and back ──────────────────────────
    test = TestResult("Navigate to Different Page and Back")
    results.append(test)
    try:
        # Navigate to the keyboard test page
        keyboard_url = f"http://localhost:{port}/keyboard-test.html"
        await call_tool(session, "navigate", {
            "session_id": session_id,
            "url": keyboard_url,
        })
        await asyncio.sleep(0.5)

        url_result = await call_tool(session, "get_current_url", {
            "session_id": session_id,
        })
        data = json.loads(url_result)
        if "keyboard-test.html" in data.get("url", ""):
            # Navigate back
            await call_tool(session, "navigate", {
                "session_id": session_id,
                "url": base_url,
            })
            await asyncio.sleep(0.5)

            url_result2 = await call_tool(session, "get_current_url", {
                "session_id": session_id,
            })
            data2 = json.loads(url_result2)
            if "navigation-test.html" in data2.get("url", ""):
                test.mark_pass()
            else:
                test.mark_fail(f"Expected back at navigation-test.html, got: '{data2.get('url')}'")
        else:
            test.mark_fail(f"Expected keyboard-test.html, got: '{data.get('url')}'")
    except Exception as e:
        test.mark_fail(str(e))

    # ── Test 6: Navigate with wait_until option ──────────────────────────────
    test = TestResult("Navigate with wait_until=domcontentloaded")
    results.append(test)
    try:
        nav_result = await call_tool(session, "navigate", {
            "session_id": session_id,
            "url": base_url,
            "wait_until": "domcontentloaded",
        })
        if "Navigated to:" in nav_result:
            test.mark_pass()
        else:
            test.mark_fail(f"Unexpected response: {nav_result}")
    except Exception as e:
        test.mark_fail(str(e))

    return results


async def run_start_url_test(port: int, browser: str) -> TestResult:
    """Test that start_browser with url parameter works."""
    test = TestResult("Start Browser with Initial URL")

    try:
        server_params = StdioServerParameters(
            command="node",
            args=[SERVER_SCRIPT],
        )

        async with stdio_client(server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()

                target_url = f"http://localhost:{port}/navigation-test.html?initial=true"
                start_result = await call_tool(session, "start_browser", {
                    "browser": browser,
                    "headless": True,
                    "url": target_url,
                })
                session_id = extract_session_id(start_result)

                url_result = await call_tool(session, "get_current_url", {
                    "session_id": session_id,
                })
                data = json.loads(url_result)
                url = data.get("url", "")
                if "navigation-test.html" in url and "initial=true" in url:
                    test.mark_pass()
                else:
                    test.mark_fail(f"Expected URL with initial=true, got: '{url}'")

    except Exception as e:
        test.mark_fail(str(e))

    return test


async def main(browser: str) -> None:
    test_pages_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-pages")
    port = find_free_port()
    server = start_test_server(port, test_pages_dir)
    BASE_URL = f"http://localhost:{port}/navigation-test.html"

    print(f"Started local test server on port {port}")
    print(f"Serving directory: {test_pages_dir}")
    print(f"Browser: {browser}")
    print(f"Base URL: {BASE_URL}\n")

    all_results = []

    try:
        # Test start_browser with URL (separate session)
        start_url_result = await run_start_url_test(port, browser)
        all_results.append(start_url_result)

        # Main tests
        server_params = StdioServerParameters(
            command="node",
            args=[SERVER_SCRIPT],
        )

        print(f"\nStarting MCP server: node {SERVER_SCRIPT}\n")

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

                test_results = await run_tests(session, session_id, BASE_URL, port)
                all_results.extend(test_results)

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
    print(f"Base URL: {BASE_URL}")
    print(f"Test Page: navigation-test.html")
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
    parser = argparse.ArgumentParser(description="Test navigation and URL tools")
    parser.add_argument(
        "browser",
        choices=["chrome", "firefox"],
        help="Browser to use for testing",
    )
    args = parser.parse_args()
    asyncio.run(main(args.browser))
