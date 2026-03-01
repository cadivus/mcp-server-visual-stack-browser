import { createWorker } from "tesseract.js";
import type Tesseract from "tesseract.js";
import sharp from "sharp";
import type { ToolResponse } from "../types.js";
import { OcrScreenshotSchema, OcrScreenshotSearchSchema } from "../schemas.js";
import { getPage } from "../session.js";

/**
 * Preprocess image for better OCR on light-on-dark text (e.g. white text on blue buttons).
 * Returns both original and inverted/enhanced versions for dual recognition.
 */
async function preprocessForOcr(imageBuffer: Buffer): Promise<{ original: Buffer; inverted: Buffer }> {
  // Grayscale + normalize for original
  const original = await sharp(imageBuffer)
    .grayscale()
    .normalize()
    .toBuffer();

  // Inverted version: grayscale, negate, increase contrast for light-on-dark text
  const inverted = await sharp(imageBuffer)
    .grayscale()
    .negate()
    .normalize()
    .sharpen()
    .toBuffer();

  return { original, inverted };
}

/**
 * Normalize text for safe JSON output: convert curly quotes and other problematic
 * Unicode characters to their ASCII equivalents.
 */
function normalizeText(text: string): string {
  return text
    .replace(/[\u201C\u201D]/g, '"')  // curly double quotes → straight
    .replace(/[\u2018\u2019]/g, "'")  // curly single quotes → straight
    .replace(/\u2013/g, '-')          // en dash → hyphen
    .replace(/\u2014/g, '--')         // em dash → double hyphen
    .replace(/\u2026/g, '...');       // ellipsis → three dots
}

interface OcrEntry {
  text: string;
  center_x: number;
  center_y: number;
  width: number;
  height: number;
  confidence: number;
  /** Present only in blocks mode — hints about whether this text looks like a button. */
  has_border?: boolean;
  is_likely_button?: boolean;
  /** Top-left X of the detected border rectangle (only present when has_border=true). */
  border_x0?: number;
  /** Top-left Y of the detected border rectangle (only present when has_border=true). */
  border_y0?: number;
  /** Bottom-right X of the detected border rectangle (only present when has_border=true). */
  border_x1?: number;
  /** Bottom-right Y of the detected border rectangle (only present when has_border=true). */
  border_y1?: number;
}

interface OcrSearchEntry {
  phrase: string;
  granularity: string;
  center_x: number;
  center_y: number;
}

type BboxItem = { text: string; confidence: number; bbox: Tesseract.Bbox };

function toEntry(item: BboxItem): OcrEntry {
  const { x0, y0, x1, y1 } = item.bbox;
  return {
    text: item.text.trim(),
    center_x: Math.round((x0 + x1) / 2),
    center_y: Math.round((y0 + y1) / 2),
    width: x1 - x0,
    height: y1 - y0,
    confidence: item.confidence,
  };
}

function toSearchEntry(item: BboxItem, granularity: string): OcrSearchEntry {
  const { x0, y0, x1, y1 } = item.bbox;
  return {
    phrase: item.text.trim(),
    granularity,
    center_x: Math.round((x0 + x1) / 2),
    center_y: Math.round((y0 + y1) / 2),
  };
}

/** Normalise text for matching: lower-case + replace common umlauts so that
 *  e.g. searching "AO" also matches "ÄÖ" and vice-versa. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/Ü/g, "U")
    .replace(/Ä/g, "A")
    .replace(/Ö/g, "O")
    .replace(/ü/g, "u")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .toLowerCase();
}

/**
 * Cluster word-level OCR results into spatially grouped phrases.
 * Words on the same row that are close together horizontally are merged;
 * a large horizontal gap (> 1.5× avg word height) starts a new cluster.
 * This isolates visually distinct UI elements (buttons, labels, links).
 */
function clusterWords(blocks: Tesseract.Block[]): OcrEntry[] {
  const words = blocks
    .flatMap((b) => b.paragraphs)
    .flatMap((p) => p.lines)
    .flatMap((l) => l.words)
    .filter((w) => w.text.trim())
    .map((w) => ({ ...toEntry(w), bbox: w.bbox }));

  if (words.length === 0) return [];

  // Sort by vertical centre first, then horizontal
  words.sort((a, b) => a.center_y - b.center_y || a.center_x - b.center_x);

  // Group into rows: words whose vertical centres are within half the
  // average word height are considered on the same row.
  const avgHeight = words.reduce((s, w) => s + w.height, 0) / words.length;
  const rowThreshold = avgHeight * 0.7;

  const rows: (typeof words)[] = [];
  let currentRow: typeof words = [words[0]];
  for (let i = 1; i < words.length; i++) {
    if (Math.abs(words[i].center_y - currentRow[0].center_y) <= rowThreshold) {
      currentRow.push(words[i]);
    } else {
      rows.push(currentRow);
      currentRow = [words[i]];
    }
  }
  rows.push(currentRow);

  // Within each row, split into clusters when the horizontal gap exceeds a threshold.
  const clusters: OcrEntry[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.center_x - b.center_x);

    let clusterStart = 0;
    for (let i = 1; i <= row.length; i++) {
      const gapThreshold = avgHeight * 1.5;
      const prevRight = row[i - 1].center_x + row[i - 1].width / 2;
      const curLeft = i < row.length ? row[i].center_x - row[i].width / 2 : Infinity;
      const gap = curLeft - prevRight;

      if (gap > gapThreshold || i === row.length) {
        // Emit cluster from clusterStart..i-1
        const slice = row.slice(clusterStart, i);
        const text = slice.map((w) => w.text).join(" ");
        const x0 = Math.min(...slice.map((w) => w.center_x - w.width / 2));
        const y0 = Math.min(...slice.map((w) => w.center_y - w.height / 2));
        const x1 = Math.max(...slice.map((w) => w.center_x + w.width / 2));
        const y1 = Math.max(...slice.map((w) => w.center_y + w.height / 2));
        const avgConf = Math.round(slice.reduce((s, w) => s + w.confidence, 0) / slice.length);

        clusters.push({
          text,
          center_x: Math.round((x0 + x1) / 2),
          center_y: Math.round((y0 + y1) / 2),
          width: Math.round(x1 - x0),
          height: Math.round(y1 - y0),
          confidence: avgConf,
        });
        clusterStart = i;
      }
    }
  }

  return clusters;
}

// ── button detection helpers ──────────────────────────────────────────────────

function getPixel(
  data: Buffer,
  width: number,
  channels: number,
  px: number,
  py: number,
  maxW: number,
  maxH: number,
): [number, number, number] {
  px = Math.max(0, Math.min(maxW - 1, px));
  py = Math.max(0, Math.min(maxH - 1, py));
  const idx = (py * width + px) * channels;
  return [data[idx], data[idx + 1], data[idx + 2]];
}

function colorDiff(a: [number, number, number], b: [number, number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** Return the median value of an array, or undefined if empty. */
function medianPos(arr: number[]): number | undefined {
  if (arr.length === 0) return undefined;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Analyse the original colour screenshot behind a text cluster to determine
 * whether it looks like a button (visible border).
 */
async function detectButtonHints(
  colorImage: Buffer,
  entry: OcrEntry,
  imgWidth: number,
  imgHeight: number,
): Promise<{ has_border: boolean; is_likely_button: boolean; border_x0?: number; border_y0?: number; border_x1?: number; border_y1?: number }> {
  const x0 = entry.center_x - Math.floor(entry.width / 2);
  const y0 = entry.center_y - Math.floor(entry.height / 2);

  // Expand region to include potential borders – buttons can have internal
  // padding up to ~2× the text height (e.g. 16-24 px for a 14 px label),
  // so we need to reach well past the border into the page background.
  const pad = Math.max(30, Math.round(entry.height * 2));
  const ex = Math.max(0, x0 - pad);
  const ey = Math.max(0, y0 - pad);
  const ew = Math.min(imgWidth - ex, entry.width + pad * 2);
  const eh = Math.min(imgHeight - ey, entry.height + pad * 2);

  if (ew < 4 || eh < 4) {
    return { has_border: false, is_likely_button: false };
  }

  const { data, info } = await sharp(colorImage)
    .extract({ left: ex, top: ey, width: ew, height: eh })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ch = info.channels;
  const gp = (px: number, py: number) => getPixel(data, info.width, ch, px, py, info.width, info.height);

  // Inner bbox within extracted region (where the text sits)
  const il = pad; // inner left
  const it = pad; // inner top
  const ir = pad + entry.width - 1;
  const ib = pad + entry.height - 1;

  // ── Border detection: scan the full padding zone for colour transitions ──────────
  // Instead of sampling at a fixed offset from the text edge, scan every
  // adjacent pixel pair across the entire padding strip on each side.
  // This catches borders at any distance from the text.
  const scanSamples = 5;
  let edgesWithBorder = 0;
  let totalEdges = 0;

  // Collect the pixel position of the strongest transition per sample per side
  const topBorderPositions: number[] = [];
  const bottomBorderPositions: number[] = [];
  const leftBorderPositions: number[] = [];
  const rightBorderPositions: number[] = [];

  for (let i = 0; i < scanSamples; i++) {
    const t = (i + 1) / (scanSamples + 1);
    const sx = Math.round(il + t * entry.width);
    const sy = Math.round(it + t * entry.height);

    // Top edge: scan vertically from top of extracted region to text top
    totalEdges++;
    let maxD = 0;
    let maxPyTop = 0;
    for (let py = 0; py < it && py < info.height - 1; py++) {
      const d = colorDiff(gp(sx, py), gp(sx, py + 1));
      if (d > maxD) { maxD = d; maxPyTop = py; }
    }
    if (maxD > 40) { edgesWithBorder++; topBorderPositions.push(maxPyTop); }

    // Bottom edge: scan from text bottom to bottom of extracted region
    totalEdges++;
    maxD = 0;
    let maxPyBot = ib;
    for (let py = ib; py < info.height - 1; py++) {
      const d = colorDiff(gp(sx, py), gp(sx, py + 1));
      if (d > maxD) { maxD = d; maxPyBot = py; }
    }
    if (maxD > 40) { edgesWithBorder++; bottomBorderPositions.push(maxPyBot); }

    // Left edge: scan horizontally from left of extracted region to text left
    totalEdges++;
    maxD = 0;
    let maxPxLeft = 0;
    for (let px = 0; px < il && px < info.width - 1; px++) {
      const d = colorDiff(gp(px, sy), gp(px + 1, sy));
      if (d > maxD) { maxD = d; maxPxLeft = px; }
    }
    if (maxD > 40) { edgesWithBorder++; leftBorderPositions.push(maxPxLeft); }

    // Right edge: scan from text right to right of extracted region
    totalEdges++;
    maxD = 0;
    let maxPxRight = ir;
    for (let px = ir; px < info.width - 1; px++) {
      const d = colorDiff(gp(px, sy), gp(px + 1, sy));
      if (d > maxD) { maxD = d; maxPxRight = px; }
    }
    if (maxD > 40) { edgesWithBorder++; rightBorderPositions.push(maxPxRight); }
  }

  // A border is present when the majority of sampled edge rays hit a transition
  const has_border = totalEdges > 0 && edgesWithBorder / totalEdges > 0.4;

  if (!has_border) {
    return { has_border: false, is_likely_button: false };
  }

  // Convert median border positions from extracted-region coordinates to original image coordinates
  const topPos = medianPos(topBorderPositions);
  const botPos = medianPos(bottomBorderPositions);
  const leftPos = medianPos(leftBorderPositions);
  const rightPos = medianPos(rightBorderPositions);

  return {
    has_border: true,
    is_likely_button: true,
    border_x0: leftPos !== undefined ? ex + leftPos : undefined,
    border_y0: topPos !== undefined ? ey + topPos : undefined,
    border_x1: rightPos !== undefined ? ex + rightPos : undefined,
    border_y1: botPos !== undefined ? ey + botPos : undefined,
  };
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
    // Playwright returns a Buffer directly
    imageBuffer = Buffer.from(await page.screenshot({ type: "png" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Failed to take screenshot: ${message}` }],
    };
  }

  const { original, inverted } = await preprocessForOcr(imageBuffer);
  const worker = await createWorker(lang);

  try {
    // Run OCR on both original and inverted images to catch light-on-dark text.
    // Tesseract.js v6+ disables non-text output formats by default;
    // enable `blocks` so structured data is available.
    const [originalResult, invertedResult] = await Promise.all([
      worker.recognize(original, {}, { blocks: true }),
      worker.recognize(inverted, {}, { blocks: true }),
    ]);

    if (!wantBlocks) {
      // Plain text mode: prefer the version with more content
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

    // Merge entries: add inverted results that don't overlap significantly with original
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

    // Detect button-like regions by analysing background colour & borders
    const { width: imgW, height: imgH } = await sharp(imageBuffer).metadata() as { width: number; height: number };
    
    // First pass: detect borders for all entries
    const borderData = await Promise.all(
      entries.map(async (entry) => {
        try {
          return await detectButtonHints(imageBuffer, entry, imgW, imgH);
        } catch {
          return { has_border: false, is_likely_button: false };
        }
      }),
    );
    
    // Second pass: check if borders are shared between adjacent blocks
    // If two blocks share a border, neither should claim has_border=true
    for (let i = 0; i < entries.length; i++) {
      if (!borderData[i].has_border) continue;
      
      const entry = entries[i];
      const margin = Math.max(entry.width, entry.height) * 0.3; // proximity threshold
      
      for (let j = i + 1; j < entries.length; j++) {
        if (!borderData[j].has_border) continue;
        
        const other = entries[j];
        
        // Check if blocks are adjacent (within margin)
        const dx = Math.abs(entry.center_x - other.center_x);
        const dy = Math.abs(entry.center_y - other.center_y);
        const avgW = (entry.width + other.width) / 2;
        const avgH = (entry.height + other.height) / 2;
        
        // Blocks are adjacent if they're close horizontally or vertically
        const adjacentHorizontally = dy < avgH && dx < avgW + margin;
        const adjacentVertically = dx < avgW && dy < avgH + margin;
        
        if (adjacentHorizontally || adjacentVertically) {
          // Check if they share similar borders by comparing positions
          // If blocks are side-by-side and both have borders, they likely share the border
          const sharesBorder = 
            (adjacentHorizontally && Math.abs(dy) < avgH * 0.8) ||
            (adjacentVertically && Math.abs(dx) < avgW * 0.8);
          
          if (sharesBorder) {
            // Mark both as not having their own border (clear coordinates too)
            borderData[i] = { has_border: false, is_likely_button: false };
            borderData[j] = { has_border: false, is_likely_button: false };
          }
        }
      }
    }
    
    // Third pass: propagate borders to vertically adjacent blocks in the same container.
    // When a heading and its description sit inside the same bordered box, the narrow
    // heading may detect the border while the wider description does not. Group such
    // blocks together and expand the border to cover every member.
    const groupId = new Array<number>(entries.length).fill(-1);
    let nextGroup = 0;

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i], b = entries[j];

        // Vertical gap between the two blocks
        const aTop = a.center_y - a.height / 2;
        const aBot = a.center_y + a.height / 2;
        const bTop = b.center_y - b.height / 2;
        const bBot = b.center_y + b.height / 2;
        const vGap = Math.max(0, Math.max(bTop - aBot, aTop - bBot));
        if (vGap > 25) continue; // too far apart to be in the same container

        // Horizontal overlap – at least 30 % of the narrower block's width
        const aLeft = a.center_x - a.width / 2;
        const aRight = a.center_x + a.width / 2;
        const bLeft = b.center_x - b.width / 2;
        const bRight = b.center_x + b.width / 2;
        const overlap = Math.min(aRight, bRight) - Math.max(aLeft, bLeft);
        if (overlap < Math.min(a.width, b.width) * 0.3) continue;

        // Union-find: merge groups
        if (groupId[i] === -1 && groupId[j] === -1) {
          groupId[i] = groupId[j] = nextGroup++;
        } else if (groupId[i] === -1) {
          groupId[i] = groupId[j];
        } else if (groupId[j] === -1) {
          groupId[j] = groupId[i];
        } else if (groupId[i] !== groupId[j]) {
          const old = groupId[j];
          for (let k = 0; k < entries.length; k++) {
            if (groupId[k] === old) groupId[k] = groupId[i];
          }
        }
      }
    }

    // Collect groups and propagate borders
    const groups = new Map<number, number[]>();
    for (let i = 0; i < entries.length; i++) {
      if (groupId[i] !== -1) {
        if (!groups.has(groupId[i])) groups.set(groupId[i], []);
        groups.get(groupId[i])!.push(i);
      }
    }

    for (const [, members] of groups) {
      // Only propagate when at least one member already has a border
      const borderedMembers = members.filter((idx) => borderData[idx].has_border);
      if (borderedMembers.length === 0) continue;

      // Merge existing border coords from bordered members
      let bx0: number | undefined, by0: number | undefined;
      let bx1: number | undefined, by1: number | undefined;
      for (const idx of borderedMembers) {
        const bd = borderData[idx];
        if (bd.border_x0 !== undefined) bx0 = bx0 !== undefined ? Math.min(bx0, bd.border_x0) : bd.border_x0;
        if (bd.border_y0 !== undefined) by0 = by0 !== undefined ? Math.min(by0, bd.border_y0) : bd.border_y0;
        if (bd.border_x1 !== undefined) bx1 = bx1 !== undefined ? Math.max(bx1, bd.border_x1) : bd.border_x1;
        if (bd.border_y1 !== undefined) by1 = by1 !== undefined ? Math.max(by1, bd.border_y1) : bd.border_y1;
      }

      // Expand border to encompass every member's text bounding box
      for (const idx of members) {
        const e = entries[idx];
        const eLeft = Math.round(e.center_x - e.width / 2);
        const eRight = Math.round(e.center_x + e.width / 2);
        const eTop = Math.round(e.center_y - e.height / 2);
        const eBot = Math.round(e.center_y + e.height / 2);

        bx0 = bx0 !== undefined ? Math.min(bx0, eLeft) : eLeft;
        bx1 = bx1 !== undefined ? Math.max(bx1, eRight) : eRight;
        by0 = by0 !== undefined ? Math.min(by0, eTop) : eTop;
        by1 = by1 !== undefined ? Math.max(by1, eBot) : eBot;
      }

      // Assign the unified border to every member
      for (const idx of members) {
        borderData[idx] = {
          has_border: true,
          is_likely_button: borderData[idx].is_likely_button,
          border_x0: bx0,
          border_y0: by0,
          border_x1: bx1,
          border_y1: by1,
        };
      }
    }

    // Fourth pass: if multiple blocks share identical border coordinates, they're
    // likely multiple text elements inside the same container (not buttons).
    const borderSignatures = new Map<string, number[]>();
    for (let i = 0; i < entries.length; i++) {
      if (!borderData[i].has_border) continue;
      const sig = `${borderData[i].border_x0},${borderData[i].border_y0},${borderData[i].border_x1},${borderData[i].border_y1}`;
      if (!borderSignatures.has(sig)) borderSignatures.set(sig, []);
      borderSignatures.get(sig)!.push(i);
    }

    for (const [, indices] of borderSignatures) {
      if (indices.length > 1) {
        // Multiple blocks share the same border → they're in a container, not buttons
        for (const idx of indices) {
          borderData[idx].is_likely_button = false;
        }
      }
    }

    // Apply the border detection results and filter output fields
    const results = entries.map((entry, i) => {
      let is_likely_button = borderData[i].is_likely_button;

      // Buttons typically have short labels - if text has more than 5 words, it's likely not a button
      const wordCount = entry.text.trim().split(/\s+/).length;
      if (wordCount > 5) {
        is_likely_button = false;
      }

      // Build minimal output: text, center_x, center_y, and is_likely_button only if true
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
    // Playwright returns a Buffer directly
    imageBuffer = Buffer.from(await page.screenshot({ type: "png" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Failed to take screenshot: ${message}` }],
    };
  }

  const { original, inverted } = await preprocessForOcr(imageBuffer);
  const worker = await createWorker(lang);

  try {
    // Run OCR on both original and inverted images to catch light-on-dark text
    // Tesseract.js v6+ requires `blocks: true` to get structured word/line/paragraph data.
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

    // Merge results, avoiding duplicates at similar positions
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
