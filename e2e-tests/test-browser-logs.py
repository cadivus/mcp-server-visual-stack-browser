#!/usr/bin/env python3
"""
Test script for the selenium-dev-mcp MCP server.

Starts the MCP server as a subprocess, communicates via stdio,
launches a headless browser session, navigates to a local test page,
retrieves console logs and error stack traces, then closes the session.

Adapted from cadivus/mcp-selenium e2e-tests for the selenium-dev-mcp project.
Key differences from the original mcp-selenium tests:
  - Tool names: execute_javascript (not execute_script), get_console_log_stacktrace (not get_error_stacktrace)
  - All tools require a session_id parameter
  - No dedicated navigate or close_session tools (navigation via execute_javascript)
  - Console log format: [id] LEVEL  ISO_TIMESTAMP  message (single line, with unique ID)
  - Stack trace format: "Stack trace for [id] LEVEL — message\\n  at func (...)"
  - Server entry point: dist/index.js (TypeScript project)
"""

import asyncio
import json
import os
import sys
import socket
import threading
import argparse
import re
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
    print(f"    Arguments: {json.dumps(arguments, indent=2)}")
    print(f"{'='*60}")

    result = await session.call_tool(name, arguments)

    texts = []
    for block in result.content:
        if hasattr(block, "text"):
            texts.append(block.text)
    combined = "\n".join(texts)
    print(combined)
    return combined


def validate_console_logs(logs_text: str, port: int) -> tuple[bool, list[str]]:
    """
    Validate that console logs match the expected format.
    Returns (success, list_of_errors)

    selenium-dev-mcp log format (single line per entry):
      [id] LEVEL   ISO_TIMESTAMP  message
    Example:
      [1708966788527] INFO    2026-02-14T17:59:48.527Z  ✅ JavaScript is active and modifying the DOM.
    """
    errors = []

    print("\n" + "="*60)
    print("VALIDATING CONSOLE LOGS")
    print("="*60)

    lines = logs_text.strip().splitlines()

    # Look for expected INFO messages
    expected_messages = [
        "✅ JavaScript is active and modifying the DOM.",
        "Processing... (about to fail)"
    ]
    found_messages = []

    for line in lines:
        # Parse format: [id] LEVEL   ISO_TIMESTAMP  message
        match = re.match(
            r'\[(\S+)\]\s+(\w+)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s+(.*)',
            line
        )
        if match:
            log_id, level, timestamp, message = match.groups()
            print(f"  Found log entry: [{log_id}] {level} {timestamp} {message}")

            if level == "INFO":
                # Check timestamp format (ISO 8601)
                if re.match(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', timestamp):
                    print(f"✅ Correct timestamp format: {timestamp}")
                else:
                    errors.append(f"❌ INFO log timestamp format incorrect. Got: {timestamp}")

                # Check if this is an expected message
                for expected_msg in expected_messages:
                    if expected_msg in message:
                        found_messages.append(expected_msg)
                        print(f"✅ Found expected message: {expected_msg}")

    print(f"\nExpected messages: {expected_messages}")
    print(f"Found messages: {found_messages}")

    # Verify all expected messages were found
    for expected_msg in expected_messages:
        if expected_msg not in found_messages:
            errors.append(f"❌ Expected message not found: '{expected_msg}'")

    return (len(errors) == 0, errors)


def validate_stacktrace(stacktrace_text: str, port: int) -> tuple[bool, list[str]]:
    """
    Validate that the stacktrace matches the expected format.
    Returns (success, list_of_errors)

    selenium-dev-mcp returns format:
      Stack trace for [id] LEVEL — message

        at triggerCrash (http://localhost:PORT/logging-test.html:58:13)
        at processData (http://localhost:PORT/logging-test.html:53:13)
        at startChain (http://localhost:PORT/logging-test.html:48:13)
        at (anonymous) (http://localhost:PORT/logging-test.html:62:9)
    """
    errors = []

    print("\n" + "="*60)
    print("VALIDATING STACK TRACE")
    print("="*60)

    lines = stacktrace_text.strip().splitlines()

    # Check that we got a stack trace (not "No stack trace available")
    if "No stack trace available" in stacktrace_text:
        errors.append("❌ No stack trace available for this log entry")
        return (False, errors)

    # Check for stack trace header
    if lines and lines[0].startswith("Stack trace for"):
        print(f"✅ Found stack trace header: {lines[0]}")
    else:
        errors.append(
            f"❌ Expected stack trace header starting with 'Stack trace for'. "
            f"Got: '{lines[0] if lines else '(empty)'}'"
        )

    # Validate stack trace lines - look for expected functions in order
    expected_functions = ["triggerCrash", "processData", "startChain", "(anonymous)"]

    for func_name in expected_functions:
        found = False
        for line in lines:
            if func_name in line and f"http://localhost:{port}/logging-test.html" in line:
                print(f"✅ Found stack frame: {line.strip()}")
                found = True
                break
        if not found:
            errors.append(
                f"❌ Stack frame not found or incorrect format for function: {func_name}"
            )

    return (len(errors) == 0, errors)


async def main(browser: str) -> None:
    # Start local test server
    test_pages_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-pages")
    port = find_free_port()
    server = start_test_server(port, test_pages_dir)
    TARGET_URL = f"http://localhost:{port}/logging-test.html"

    print(f"Started local test server on port {port}")
    print(f"Serving directory: {test_pages_dir}")
    print(f"Browser: {browser}")

    validation_passed = True
    all_errors = []

    try:
        server_params = StdioServerParameters(
            command="node",
            args=[SERVER_SCRIPT],
        )

        print(f"Starting MCP Selenium server: node {SERVER_SCRIPT}")
        print(f"Target URL: {TARGET_URL}\n")

        async with stdio_client(server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()

                # List available tools
                tools_result = await session.list_tools()
                print(f"Available tools ({len(tools_result.tools)}):")
                for tool in tools_result.tools:
                    print(f"  - {tool.name}: {tool.description}")

                # 1. Start headless browser
                # selenium-dev-mcp uses top-level headless param (not nested options)
                start_result = await call_tool(session, "start_browser", {
                    "browser": browser,
                    "headless": True,
                })
                session_id = extract_session_id(start_result)
                print(f"Extracted session ID: {session_id}")

                # 2. Navigate to the target URL
                # selenium-dev-mcp has no dedicated navigate tool — use execute_javascript
                await call_tool(session, "execute_javascript", {
                    "session_id": session_id,
                    "script": f"window.location.href = '{TARGET_URL}';",
                })

                # Wait for the page to fully load and errors to fire
                await asyncio.sleep(3)

                # 3. Get console logs
                logs_text = await call_tool(session, "get_console_logs", {
                    "session_id": session_id,
                })

                # Validate console logs
                logs_valid, logs_errors = validate_console_logs(logs_text, port)
                if not logs_valid:
                    validation_passed = False
                    all_errors.extend([("Console Logs", error) for error in logs_errors])

                # 4. Look for the specific ReferenceError and get its stack trace
                EXPECTED_ERROR = "forceSystemErrorNow is not defined"

                # Parse log lines to find the SEVERE entry with the expected error
                log_lines = logs_text.splitlines()
                matching_log_id: str | None = None

                for line in log_lines:
                    match = re.match(r'\[(\S+)\]\s+(\w+)\s+\S+\s+(.*)', line)
                    if match:
                        log_id, level, message = match.groups()
                        if level == "SEVERE" and EXPECTED_ERROR in message:
                            matching_log_id = log_id
                            break

                if matching_log_id:
                    print(f"\n✅ Found expected error: {EXPECTED_ERROR}")
                    print(f"   Log ID: {matching_log_id}")
                    print(f"\nFetching stack trace...")

                    # selenium-dev-mcp uses get_console_log_stacktrace with log_id
                    stacktrace_text = await call_tool(session, "get_console_log_stacktrace", {
                        "session_id": session_id,
                        "log_id": matching_log_id,
                    })

                    # Validate stack trace
                    stack_valid, stack_errors = validate_stacktrace(stacktrace_text, port)
                    if not stack_valid:
                        validation_passed = False
                        all_errors.extend([("Stack Trace", error) for error in stack_errors])
                else:
                    validation_passed = False
                    all_errors.append(("Error Detection", f"❌ Expected error NOT found: {EXPECTED_ERROR}"))

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
    print(f"Test Page: logging-test.html")
    print("="*60)

    if validation_passed:
        print("\n✅ ALL VALIDATIONS PASSED")
        print("\nTest Categories:")
        print("  ✅ Console Logs - Format and content validated")
        print("  ✅ Error Detection - Expected ReferenceError found")
        print("  ✅ Stack Trace - Complete call stack validated")
        print("\n" + "="*60)
        print("RESULT: SUCCESS")
        print("="*60)
    else:
        print("\n❌ VALIDATION FAILED")
        print(f"\nTotal Errors: {len(all_errors)}")
        print("\nErrors by Category:")

        # Group errors by category
        error_categories = {}
        for category, error in all_errors:
            if category not in error_categories:
                error_categories[category] = []
            error_categories[category].append(error)

        for category, errors in error_categories.items():
            print(f"\n  {category} ({len(errors)} error(s)):")
            for error in errors:
                print(f"    {error}")

        print("\n" + "="*60)
        print("RESULT: FAILED")
        print("="*60)

    # Exit with appropriate code
    if not validation_passed:
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test selenium-dev-mcp with a specified browser")
    parser.add_argument(
        "browser",
        choices=["chrome", "firefox"],
        help="Browser to use for testing (chrome or firefox)"
    )

    args = parser.parse_args()
    asyncio.run(main(args.browser))
