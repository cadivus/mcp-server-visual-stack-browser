#!/usr/bin/env python3
"""
Test script for the ocr_screenshot MCP tool in selenium-dev-mcp.

Launches a headless browser, navigates to the search-with-banner test page,
runs ocr_screenshot with default parameters, and prints the result.
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
    """Run all OCR tests"""
    results = []

    # Navigate to test page using execute_javascript (no dedicated navigate tool)
    await call_tool(session, "execute_javascript", {
        "session_id": session_id,
        "script": f"window.location.href = '{target_url}';",
    })
    await asyncio.sleep(2)  # Let page load

    # Test text mode
    text_mode_result = await test_text_mode(session, session_id)
    results.append(text_mode_result)

    # Test blocks mode
    blocks_mode_result = await test_blocks_mode(session, session_id)
    results.append(blocks_mode_result)

    return results


async def test_text_mode(session: ClientSession, session_id: str) -> TestResult:
    """Test OCR in plain text mode"""
    test = TestResult("OCR Text Mode")
    
    print(f"\n{'='*60}")
    print(f"Testing ocr_screenshot in text mode")
    print(f"{'='*60}")
    
    try:
        ocr_result = await call_tool(session, "ocr_screenshot", {
            "session_id": session_id,
        })

        # Expected text fragments that should appear in the output
        expected_fragments = [
            "We value your privacy",
            "Strictly necessary",
            "Performance & analytics",
            "Advertising",
            "Decline",
            "Accept all cookies",
        ]
        
        missing_fragments = []
        for fragment in expected_fragments:
            if fragment.lower() in ocr_result.lower():
                print(f"  ✓ Found '{fragment}'")
            else:
                print(f"  ✗ Missing '{fragment}'")
                missing_fragments.append(fragment)
        
        if missing_fragments:
            test.mark_fail(f"Missing text fragments: {', '.join(missing_fragments)}")
        else:
            test.mark_pass()
            
    except Exception as e:
        test.mark_fail(str(e))
    
    return test


async def test_blocks_mode(session: ClientSession, session_id: str) -> TestResult:
    """Test OCR in blocks mode with coordinate and button detection"""
    test = TestResult("OCR Blocks Mode")
    
    print(f"\n{'='*60}")
    print(f"Testing ocr_screenshot in blocks mode")
    print(f"{'='*60}")
    
    try:
        ocr_result = await call_tool(session, "ocr_screenshot", {
            "session_id": session_id,
            "blocks": True,
        })

        results = json.loads(ocr_result)
        
        # Expected entries with 2-pixel tolerance for coordinates
        expected = [
            {"text": "We value your privacy", "center_x": 195, "center_y": 191, "is_likely_button": False},
            {"text": "Strictly necessary", "center_x": 168, "center_y": 296, "is_likely_button": False},
            {"text": "Required for basic website functionality. Always active.", "center_x": 259, "center_y": 320, "is_likely_button": False},
            {"text": "Performance & analytics", "center_x": 191, "center_y": 375, "is_likely_button": False},
            {"text": "Advertising", "center_x": 144, "center_y": 453, "is_likely_button": False},
            {"text": "Decline", "center_x": 989, "center_y": 569, "is_likely_button": True},
            {"text": "Accept all cookies", "center_x": 1116, "center_y": 569, "is_likely_button": True},
        ]
        
        def coords_match(actual_x, actual_y, expected_x, expected_y, tolerance=2):
            """Check if coordinates match within tolerance."""
            return (abs(actual_x - expected_x) <= tolerance and 
                    abs(actual_y - expected_y) <= tolerance)
        
        def find_entry(results, text_fragment):
            """Find an entry that contains the given text fragment."""
            for entry in results:
                if text_fragment.lower() in entry["text"].lower():
                    return entry
            return None
        
        validation_errors = []
        for exp in expected:
            entry = find_entry(results, exp["text"])
            if not entry:
                error = f"Entry not found: '{exp['text']}'"
                print(f"  ✗ {error}")
                validation_errors.append(error)
                continue
            
            # Check coordinates
            if not coords_match(entry["center_x"], entry["center_y"], 
                              exp["center_x"], exp["center_y"]):
                error = f"'{exp['text']}' - coordinates mismatch: expected ({exp['center_x']}, {exp['center_y']}), got ({entry['center_x']}, {entry['center_y']})"
                print(f"  ✗ {error}")
                validation_errors.append(error)
                continue
            
            # Check is_likely_button status
            expected_button = exp.get("is_likely_button", False)
            actual_button = entry.get("is_likely_button", False)
            
            if expected_button != actual_button:
                error = f"'{exp['text']}' - button status mismatch: expected {expected_button}, got {actual_button}"
                print(f"  ✗ {error}")
                validation_errors.append(error)
                continue
            
            button_status = " [button]" if actual_button else ""
            print(f"  ✓ '{exp['text']}' at ({entry['center_x']}, {entry['center_y']}){button_status}")
        
        if validation_errors:
            test.mark_fail("; ".join(validation_errors))
        else:
            test.mark_pass()
            
    except Exception as e:
        test.mark_fail(str(e))
    
    return test


async def main(browser: str) -> None:
    # Start local test server
    test_pages_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-pages")
    port = find_free_port()
    server = start_test_server(port, test_pages_dir)
    TARGET_URL = f"http://localhost:{port}/search-with-banner.html"

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
    print(f"Test Page: search-with-banner.html")
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
    parser = argparse.ArgumentParser(description="Test selenium-dev-mcp ocr_screenshot with a specified browser")
    parser.add_argument(
        "browser",
        choices=["chrome", "firefox"],
        help="Browser to use for testing (chrome or firefox)"
    )

    args = parser.parse_args()
    asyncio.run(main(args.browser))
