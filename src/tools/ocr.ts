import { createWorker } from "tesseract.js";
import type Tesseract from "tesseract.js";
import sharp from "sharp";
import os from "os";
import path from "path";
import fs from "fs";
import type { ToolResponse } from "../types.js";
import { OcrScreenshotSchema, OcrScreenshotSearchSchema } from "../schemas.js";
import { getPage } from "../session.js";

import {
  type BboxItem,
  type OcrSearchEntry,
  preprocessForOcr,
  normalizeText,
  normalizeForMatch,
  clusterWords,
  detectButtons,
  toSearchEntry,
} from "../ocr/index.js";

// cache directory for tesseract traineddata
const TESS_CACHE_DIR = path.join(os.tmpdir(), "selenium-dev-mcp-tessdata");

// ensure directory exists before worker tries to write
try {
  fs.mkdirSync(TESS_CACHE_DIR, { recursive: true });
} catch (err) {
  // if creation fails, we'll simply let tesseract.js fall back to default
  // but we'll log to console to aid debugging
  console.warn(`Unable to create Tesseract cache dir ${TESS_CACHE_DIR}:`, err);
}

// ── ocr_screenshot ────────────────────────────────────────────────────────────

export const ocrScreenshotTool = {
  name: "ocr_screenshot",
  description:
    "PREFERRED over take_screenshot when you only need text or want to locate/click a text element (cheaper, no vision model needed). " +
    "Runs OCR on the current page. blocks=false (default) returns a plain string. " +
    "blocks=true returns JSON: [{ text, center_x, center_y, is_likely_button? }] — " +
    "spatially grouped phrases that isolate buttons, labels, links, etc. " +
    "is_likely_button field is only present when true (text has a visible border/frame and looks clickable). " +
    "center_x/center_y are ready to pass to click_at_coordinates. " +
    "Use ocr_screenshot_search to find a specific word or phrase.",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "Session ID returned by start_browser.",
      },
      lang: {
        type: "string",
        description: "Tesseract language code(s), e.g. 'eng', 'deu', 'eng+deu' (default: 'eng').",
      },
      blocks: {
        type: "boolean",
        description:
          "false (default) = plain text string. " +
          "true = JSON array of spatially grouped phrases: [{ text, center_x, center_y, width, height, confidence }]. " +
          "Good for isolating buttons, labels, links.",
      },
    },
    required: ["session_id"],
    additionalProperties: false,
  },
};

export async function handleOcrScreenshot(args: unknown): Promise<ToolResponse> {
  const parsed = OcrScreenshotSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
    };
  }

  const { session_id, lang, blocks: wantBlocks } = parsed.data;
  const page = getPage(session_id);
  if (!page) {
    return {
      isError: true,
      content: [{ type: "text", text: `No session found with ID: ${session_id}` }],
    };
  }

  let imageBuffer: Buffer;
  try {
    imageBuffer = Buffer.from(await page.screenshot({ type: "png" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Failed to take screenshot: ${message}` }],
    };
  }

  const { original, inverted } = await preprocessForOcr(imageBuffer);

  const worker = await createWorker(lang, undefined, {
    cachePath: TESS_CACHE_DIR,
  });

  try {
    const [originalResult, invertedResult] = await Promise.all([
      worker.recognize(original, {}, { blocks: true }),
      worker.recognize(inverted, {}, { blocks: true }),
    ]);

    if (!wantBlocks) {
      const origText = originalResult.data.text.trim();
      const invText = invertedResult.data.text.trim();
      const combined = origText.length >= invText.length ? origText : `${origText}\n${invText}`;
      return {
        content: [{ type: "text", text: combined || "(no text recognised)" }],
      };
    }

    // Blocks mode: cluster words into spatially grouped phrases
    const origEntries = clusterWords(originalResult.data.blocks ?? []);
    const invEntries = clusterWords(invertedResult.data.blocks ?? []);

    // Merge entries, avoiding near-duplicates from the inverted pass
    const entries = [...origEntries];
    for (const inv of invEntries) {
      const isDuplicate = origEntries.some(
        (orig) =>
          Math.abs(orig.center_x - inv.center_x) < 20 &&
          Math.abs(orig.center_y - inv.center_y) < 20
      );
      if (!isDuplicate) {
        entries.push(inv);
      }
    }

    // Button detection (multi-pass heuristics)
    const { width: imgW, height: imgH } = await sharp(imageBuffer).metadata() as { width: number; height: number };
    const borderData = await detectButtons(imageBuffer, entries, imgW, imgH);

    // Build minimal output
    const results = entries.map((entry, i) => {
      let is_likely_button = borderData[i].is_likely_button;

      // Buttons typically have short labels
      const wordCount = entry.text.trim().split(/\s+/).length;
      if (wordCount > 5) {
        is_likely_button = false;
      }

      const result: { text: string; center_x: number; center_y: number; is_likely_button?: boolean } = {
        text: normalizeText(entry.text),
        center_x: entry.center_x,
        center_y: entry.center_y,
      };

      if (is_likely_button) {
        result.is_likely_button = true;
      }

      return result;
    });

    return {
      content: [{ type: "text", text: results.length ? JSON.stringify(results, null, 2) : "(no text recognised)" }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `OCR failed: ${message}` }],
    };
  } finally {
    await worker.terminate();
  }
}

// ── ocr_screenshot_search ─────────────────────────────────────────────────────

export const ocrScreenshotSearchTool = {
  name: "ocr_screenshot_search",
  description:
    "OCR the current page and search for a specific word or phrase. " +
    "Returns all matches as [{ phrase, granularity, center_x, center_y }] — " +
    "center_x/center_y are ready to pass to click_at_coordinates. " +
    "Searches across all granularity levels (word → line → paragraph → block) so " +
    "both single words and multi-word phrases are found.",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "Session ID returned by start_browser.",
      },
      needle: {
        type: "string",
        description: "Case-insensitive substring to search for, e.g. 'akzeptieren' or 'Sign in'.",
      },
      lang: {
        type: "string",
        description: "Tesseract language code(s), e.g. 'eng', 'deu', 'eng+deu' (default: 'eng').",
      },
    },
    required: ["session_id", "needle"],
    additionalProperties: false,
  },
};

export async function handleOcrScreenshotSearch(args: unknown): Promise<ToolResponse> {
  const parsed = OcrScreenshotSearchSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
    };
  }

  const { session_id, needle, lang } = parsed.data;
  const normalizedNeedle = normalizeForMatch(needle);
  const page = getPage(session_id);
  if (!page) {
    return {
      isError: true,
      content: [{ type: "text", text: `No session found with ID: ${session_id}` }],
    };
  }

  let imageBuffer: Buffer;
  try {
    imageBuffer = Buffer.from(await page.screenshot({ type: "png" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Failed to take screenshot: ${message}` }],
    };
  }

  const { original, inverted } = await preprocessForOcr(imageBuffer);

  const worker = await createWorker(lang, undefined, {
    cachePath: TESS_CACHE_DIR,
  });

  try {
    const [originalResult, invertedResult] = await Promise.all([
      worker.recognize(original, {}, { blocks: true }),
      worker.recognize(inverted, {}, { blocks: true }),
    ]);

    function searchInData(data: Tesseract.Page): OcrSearchEntry[] {
      const blocks = data.blocks ?? [];
      const found: OcrSearchEntry[] = [];

      const levels: Array<{ granularity: string; items: BboxItem[] }> = [
        {
          granularity: "word",
          items: blocks.flatMap((b) => b.paragraphs).flatMap((p) => p.lines).flatMap((l) => l.words),
        },
        {
          granularity: "line",
          items: blocks.flatMap((b) => b.paragraphs).flatMap((p) => p.lines),
        },
        {
          granularity: "paragraph",
          items: blocks.flatMap((b) => b.paragraphs),
        },
        {
          granularity: "block",
          items: blocks,
        },
      ];

      for (const { granularity, items } of levels) {
        for (const item of items) {
          if (item.text.trim() && normalizeForMatch(item.text).includes(normalizedNeedle)) {
            found.push(toSearchEntry(item, granularity));
          }
        }
      }
      return found;
    }

    const origResults = searchInData(originalResult.data);
    const invResults = searchInData(invertedResult.data);

    // Merge, avoiding duplicates at similar positions
    const results = [...origResults];
    for (const inv of invResults) {
      const isDuplicate = origResults.some(
        (orig) =>
          Math.abs(orig.center_x - inv.center_x) < 20 &&
          Math.abs(orig.center_y - inv.center_y) < 20
      );
      if (!isDuplicate) {
        results.push(inv);
      }
    }

    return {
      content: [{ type: "text", text: results.length ? JSON.stringify(results, null, 2) : "(no matches)" }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `OCR search failed: ${message}` }],
    };
  } finally {
    await worker.terminate();
  }
}
