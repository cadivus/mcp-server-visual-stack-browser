#!/usr/bin/env python3
"""
Test script for the ocr_screenshot MCP tool in selenium-dev-mcp.

Launches a headless browser, navigates to the search-with-banner test page,
runs ocr_screenshot with default parameters, and prints the result.
"""

import asyncio
import json
import os
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


async def main(browser: str, blocks: bool) -> None:
    # Start local test server
    test_pages_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-pages")
    port = find_free_port()
    server = start_test_server(port, test_pages_dir)
    TARGET_URL = f"http://localhost:{port}/search-with-banner.html"

    print(f"Started local test server on port {port}")
    print(f"Serving directory: {test_pages_dir}")
    print(f"Browser: {browser}")

    all_tests_passed = True

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
                start_result = await call_tool(session, "start_browser", {
                    "browser": browser,
                    "headless": True,
                })
                session_id = extract_session_id(start_result)
                print(f"Extracted session ID: {session_id}")

                # 2. Navigate to the target URL
                await call_tool(session, "execute_javascript", {
                    "session_id": session_id,
                    "script": f"window.location.href = '{TARGET_URL}';",
                })

                # Wait for the page to fully load
                await asyncio.sleep(2)

                # Test both modes if blocks not specified, otherwise just the requested mode
                modes_to_test = [blocks] if blocks is not None else [False, True]
                
                for test_blocks in modes_to_test:
                    if not await test_ocr_mode(session, session_id, test_blocks):
                        all_tests_passed = False

    finally:
        print(f"\nShutting down local test server on port {port}...")
        server.shutdown()
        server.server_close()
        print("Test server stopped.")
        
        if not all_tests_passed:
            exit(1)


async def test_ocr_mode(session: ClientSession, session_id: str, blocks: bool) -> bool:
    """Test OCR in the specified mode and return True if all tests pass."""
    print(f"\n{'='*60}")
    print(f"Testing ocr_screenshot with blocks={blocks}")
    print(f"{'='*60}")
    
    ocr_result = await call_tool(session, "ocr_screenshot", {
        "session_id": session_id,
        "blocks": blocks,
    })

    if not blocks:
        # Plain text mode - validate that expected text is present
        return validate_text_mode(ocr_result)
    else:
        # Blocks mode - validate structured output
        return validate_blocks_mode(ocr_result)


def validate_text_mode(ocr_result: str) -> bool:
    """Validate plain text OCR output."""
    print("\n" + "="*60)
    print("Validating plain text OCR results...")
    print("="*60)
    
    # Expected text fragments that should appear in the output
    expected_fragments = [
        "We value your privacy",
        "Strictly necessary",
        "Performance & analytics",
        "Advertising",
        "Decline",
        "Accept all cookies",
    ]
    
    all_passed = True
    for fragment in expected_fragments:
        if fragment.lower() in ocr_result.lower():
            print(f"✓ PASS: Found '{fragment}'")
        else:
            print(f"❌ FAIL: Missing '{fragment}'")
            all_passed = False
    
    print("\n" + "="*60)
    if all_passed:
        print("✓ All text mode tests PASSED")
    else:
        print("❌ Some text mode tests FAILED")
    print("="*60)
    
    return all_passed


def validate_blocks_mode(ocr_result: str) -> bool:
    """Validate blocks mode OCR output."""
    print("\n" + "="*60)
    print("Validating blocks mode OCR results...")
    print("="*60)
    
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
    
    all_passed = True
    for exp in expected:
        entry = find_entry(results, exp["text"])
        if not entry:
            print(f"❌ FAIL: Entry not found: '{exp['text']}'")
            all_passed = False
            continue
        
        # Check coordinates
        if not coords_match(entry["center_x"], entry["center_y"], 
                          exp["center_x"], exp["center_y"]):
            print(f"❌ FAIL: '{exp['text']}' - coordinates mismatch")
            print(f"   Expected: ({exp['center_x']}, {exp['center_y']})")
            print(f"   Got:      ({entry['center_x']}, {entry['center_y']})")
            all_passed = False
            continue
        
        # Check is_likely_button status
        expected_button = exp.get("is_likely_button", False)
        actual_button = entry.get("is_likely_button", False)
        
        if expected_button != actual_button:
            status = "button" if expected_button else "non-button"
            print(f"❌ FAIL: '{exp['text']}' - should be {status}")
            print(f"   Expected is_likely_button: {expected_button}")
            print(f"   Got is_likely_button: {actual_button}")
            all_passed = False
            continue
        
        button_status = " [button]" if actual_button else ""
        print(f"✓ PASS: '{exp['text']}' at ({entry['center_x']}, {entry['center_y']}){button_status}")
    
    print("\n" + "="*60)
    if all_passed:
        print("✓ All blocks mode tests PASSED")
    else:
        print("❌ Some blocks mode tests FAILED")
    print("="*60)
    
    return all_passed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test ocr_screenshot with the search-with-banner page")
    parser.add_argument(
        "browser",
        choices=["chrome", "firefox"],
        help="Browser to use for testing (chrome or firefox)"
    )

    args = parser.parse_args()
    
    # Always test both modes
    asyncio.run(main(args.browser, None))
