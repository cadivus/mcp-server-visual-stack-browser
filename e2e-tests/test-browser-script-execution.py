#!/usr/bin/env python3
"""
Test script for the execute_javascript MCP tool in selenium-dev-mcp.

Tests both synchronous and asynchronous JavaScript execution with various
scenarios including:
- Simple expressions and calculations
- DOM manipulation
- Passing arguments to scripts
- Returning different data types (primitives, objects, arrays)
- Async script execution with Promises

Adapted from cadivus/mcp-selenium e2e-tests for the selenium-dev-mcp project.
Key differences from the original mcp-selenium tests:
  - Tool name: execute_javascript (not execute_script)
  - All tools require a session_id parameter
  - No dedicated navigate or close_session tools
  - Result text: raw value (no "Result: " prefix), objects as pretty JSON
  - Async scripts: use return/await pattern (not manual callback)
  - Server entry point: dist/index.js (TypeScript project)
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
        s.bind(('', 0))
        s.listen(1)
        port = s.getsockname()[1]
    return port


def start_test_server(port, directory):
    """Start an HTTP server in a background thread."""
    os.chdir(directory)

    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, format, *args):
            pass  # Suppress request logs

    server = HTTPServer(('localhost', port), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def extract_session_id(response_text: str) -> str:
    """Extract session ID from start_browser response.

    selenium-dev-mcp returns text like:
      Started chrome (headless).
      Session ID: chrome-1234567890
    """
    for line in response_text.splitlines():
        if "Session ID:" in line:
            return line.split("Session ID:")[-1].strip()
    raise ValueError(f"Could not extract session ID from: {response_text}")


async def call_tool(session: ClientSession, name: str, arguments: dict) -> str:
    """Call an MCP tool and return its text content."""
    print(f"\n{'='*60}")
    print(f">>> Calling tool: {name}")

    # Format arguments with proper line breaks for readability
    formatted_args = json.dumps(arguments, indent=2)
    formatted_args = formatted_args.replace('\\n', '\n')

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
    """Track test results"""
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


async def run_tests(session: ClientSession, session_id: str, target_url: str) -> list[TestResult]:
    """Run all execute_javascript tests"""
    results = []

    # Navigate to test page using execute_javascript (no dedicated navigate tool)
    await call_tool(session, "execute_javascript", {
        "session_id": session_id,
        "script": f"window.location.href = '{target_url}';",
    })
    await asyncio.sleep(2)  # Let page load

    # Test 1: Simple expression
    test = TestResult("Simple Expression (2 + 2)")
    results.append(test)
    try:
        result = await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "return 2 + 2;",
        })
        if result.strip() == "4":
            test.mark_pass()
        else:
            test.mark_fail(f"Expected '4', got: '{result.strip()}'")
    except Exception as e:
        test.mark_fail(str(e))

    # Test 2: Get document title
    test = TestResult("Get Document Title")
    results.append(test)
    try:
        result = await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "return document.title;",
        })
        if "Script Execution Test" in result:
            test.mark_pass()
        else:
            test.mark_fail(f"Expected 'Script Execution Test', got: {result}")
    except Exception as e:
        test.mark_fail(str(e))

    # Test 3: Get element text
    test = TestResult("Get Element Text (Counter)")
    results.append(test)
    try:
        result = await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "return document.getElementById('counter').textContent;",
        })
        if result.strip() == "0":
            test.mark_pass()
        else:
            test.mark_fail(f"Expected '0', got: '{result.strip()}'")
    except Exception as e:
        test.mark_fail(str(e))

    # Test 4: Modify DOM
    test = TestResult("Modify DOM (Set Message)")
    results.append(test)
    try:
        result = await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": """
                document.getElementById('message').textContent = 'Modified by test';
                return document.getElementById('message').textContent;
            """,
        })
        if "Modified by test" in result:
            test.mark_pass()
        else:
            test.mark_fail(f"Expected 'Modified by test', got: {result}")
    except Exception as e:
        test.mark_fail(str(e))

    # Test 5: Script with arguments (single arg)
    test = TestResult("Script with Single Argument")
    results.append(test)
    try:
        result = await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "return arguments[0] * 2;",
            "args": [21],
        })
        if result.strip() == "42":
            test.mark_pass()
        else:
            test.mark_fail(f"Expected '42', got: '{result.strip()}'")
    except Exception as e:
        test.mark_fail(str(e))

    # Test 6: Script with multiple arguments
    test = TestResult("Script with Multiple Arguments")
    results.append(test)
    try:
        result = await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "return window.addNumbers(arguments[0], arguments[1], arguments[2]);",
            "args": [10, 20, 15],
        })
        if result.strip() == "45":
            test.mark_pass()
        else:
            test.mark_fail(f"Expected '45', got: '{result.strip()}'")
    except Exception as e:
        test.mark_fail(str(e))

    # Test 7: Return object
    test = TestResult("Return Object (Page Info)")
    results.append(test)
    try:
        result = await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "return window.getPageInfo();",
        })
        # selenium-dev-mcp returns objects as pretty-printed JSON
        if all(key in result for key in ['"title"', '"url"', '"timestamp"', '"counter"']):
            if "Script Execution Test" in result:
                test.mark_pass()
            else:
                test.mark_fail(f"Object missing expected title value: {result}")
        else:
            test.mark_fail(f"Expected object with title/url/timestamp/counter, got: {result}")
    except Exception as e:
        test.mark_fail(str(e))

    # Test 8: Return array
    test = TestResult("Return Array")
    results.append(test)
    try:
        result = await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "return [1, 2, 3, 'test', true];",
        })
        if all(str(item) in result for item in [1, 2, 3, 'test', 'true']):
            test.mark_pass()
        else:
            test.mark_fail(f"Expected array [1,2,3,'test',true], got: {result}")
    except Exception as e:
        test.mark_fail(str(e))

    # Test 9: Get attribute from hidden element
    test = TestResult("Get Hidden Element Attribute")
    results.append(test)
    try:
        result = await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "return document.getElementById('data-store').dataset.secret;",
        })
        if "hidden-value-12345" in result:
            test.mark_pass()
        else:
            test.mark_fail(f"Expected 'hidden-value-12345', got: {result}")
    except Exception as e:
        test.mark_fail(str(e))

    # Test 10: DOM manipulation with return value
    test = TestResult("DOM Manipulation (Add List Item)")
    results.append(test)
    try:
        result = await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "return window.addListItem('Test Item 3');",
        })
        if result.strip() == "3":
            test.mark_pass()
        else:
            test.mark_fail(f"Expected list length '3', got: '{result.strip()}'")
    except Exception as e:
        test.mark_fail(str(e))

    # Test 11: Async script with setTimeout
    # selenium-dev-mcp async: use return/await pattern (not manual callback)
    test = TestResult("Async Script with setTimeout")
    results.append(test)
    try:
        result = await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "return await new Promise(resolve => setTimeout(() => resolve('Async complete'), 500));",
            "async": True,
        })
        if "Async complete" in result:
            test.mark_pass()
        else:
            test.mark_fail(f"Expected 'Async complete', got: {result}")
    except Exception as e:
        test.mark_fail(str(e))

    # Test 12: Async script with Promise
    test = TestResult("Async Script with Promise")
    results.append(test)
    try:
        result = await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": "return await window.fetchDataAsync();",
            "async": True,
        })
        if all(key in result for key in ['"status"', '"data"', '"timestamp"']):
            if "success" in result and "Async data loaded" in result:
                test.mark_pass()
            else:
                test.mark_fail(f"Async object missing expected values: {result}")
        else:
            test.mark_fail(f"Expected async result object, got: {result}")
    except Exception as e:
        test.mark_fail(str(e))

    # Test 13: Async script with arguments
    test = TestResult("Async Script with Arguments")
    results.append(test)
    try:
        result = await call_tool(session, "execute_javascript", {
            "session_id": session_id,
            "script": """
                var multiplier = arguments[0];
                return await new Promise(resolve =>
                    setTimeout(() => resolve(42 * multiplier), 300)
                );
            """,
            "args": [2],
            "async": True,
        })
        if result.strip() == "84":
            test.mark_pass()
        else:
            test.mark_fail(f"Expected '84', got: '{result.strip()}'")
    except Exception as e:
        test.mark_fail(str(e))

    return results


async def main(browser: str) -> None:
    # Start local test server
    test_pages_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-pages")
    port = find_free_port()
    server = start_test_server(port, test_pages_dir)
    TARGET_URL = f"http://localhost:{port}/script-execution-test.html"

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

        print(f"Starting MCP Selenium server: node {SERVER_SCRIPT}\n")

        async with stdio_client(server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()

                # List available tools
                tools_result = await session.list_tools()
                print(f"Available tools ({len(tools_result.tools)}):")
                for tool in tools_result.tools:
                    print(f"  - {tool.name}: {tool.description}")

                # Start headless browser
                # selenium-dev-mcp uses top-level headless param (not nested options)
                start_result = await call_tool(session, "start_browser", {
                    "browser": browser,
                    "headless": True,
                })
                session_id = extract_session_id(start_result)
                print(f"Extracted session ID: {session_id}")

                # Run all tests
                all_results = await run_tests(session, session_id, TARGET_URL)

                # No close_session tool in selenium-dev-mcp;
                # the server cleans up sessions on SIGTERM when the context manager exits.

    finally:
        # Kill the test server
        print(f"\nShutting down local test server on port {port}...")
        server.shutdown()
        server.server_close()
        print("Test server stopped.")

    # Print comprehensive test report
    print("\n" + "="*60)
    print("TEST REPORT")
    print("="*60)
    print(f"Browser: {browser}")
    print(f"Test URL: {TARGET_URL}")
    print(f"Test Page: script-execution-test.html")
    print("="*60)

    passed_tests = [r for r in all_results if r.passed]
    failed_tests = [r for r in all_results if not r.passed]

    print(f"\nTotal Tests: {len(all_results)}")
    print(f"Passed: {len(passed_tests)}")
    print(f"Failed: {len(failed_tests)}")

    if failed_tests:
        print("\n❌ FAILED TESTS:")
        for test in failed_tests:
            print(f"  • {test.name}")
            print(f"    Error: {test.error}")

    if passed_tests:
        print("\n✅ PASSED TESTS:")
        for test in passed_tests:
            print(f"  • {test.name}")

    print("\n" + "="*60)
    if len(failed_tests) == 0:
        print("RESULT: SUCCESS - All tests passed!")
    else:
        print(f"RESULT: FAILED - {len(failed_tests)} test(s) failed")
    print("="*60)

    # Exit with appropriate code
    if len(failed_tests) > 0:
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test selenium-dev-mcp execute_javascript with a specified browser")
    parser.add_argument(
        "browser",
        choices=["chrome", "firefox"],
        help="Browser to use for testing (chrome or firefox)"
    )

    args = parser.parse_args()
    asyncio.run(main(args.browser))
