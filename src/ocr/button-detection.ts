import sharp from "sharp";
import type { OcrEntry } from "./types.js";

// ── Pixel helpers ─────────────────────────────────────────────────────────────

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

// ── Border detection result ───────────────────────────────────────────────────

export interface BorderResult {
  has_border: boolean;
  is_likely_button: boolean;
  border_x0?: number;
  border_y0?: number;
  border_x1?: number;
  border_y1?: number;
}

// ── Single-entry border detection ─────────────────────────────────────────────

/**
 * Analyse the original colour screenshot around a text cluster to determine
 * whether it looks like a button (visible border / colour transition).
 */
export async function detectButtonHints(
  colorImage: Buffer,
  entry: OcrEntry,
  imgWidth: number,
  imgHeight: number,
): Promise<BorderResult> {
  const x0 = entry.center_x - Math.floor(entry.width / 2);
  const y0 = entry.center_y - Math.floor(entry.height / 2);

  // Expand region to include potential borders – buttons can have internal
  // padding up to ~2× the text height, so we need to reach well past
  // the border into the page background.
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
  const gp = (px: number, py: number) =>
    getPixel(data, info.width, ch, px, py, info.width, info.height);

  // Inner bbox within extracted region (where the text sits)
  const il = pad;
  const it = pad;
  const ir = pad + entry.width - 1;
  const ib = pad + entry.height - 1;

  // Scan the padding zone for colour transitions on each side
  const scanSamples = 5;
  let edgesWithBorder = 0;
  let totalEdges = 0;

  const topBorderPositions: number[] = [];
  const bottomBorderPositions: number[] = [];
  const leftBorderPositions: number[] = [];
  const rightBorderPositions: number[] = [];

  for (let i = 0; i < scanSamples; i++) {
    const t = (i + 1) / (scanSamples + 1);
    const sx = Math.round(il + t * entry.width);
    const sy = Math.round(it + t * entry.height);

    // Top edge
    totalEdges++;
    let maxD = 0;
    let maxPyTop = 0;
    for (let py = 0; py < it && py < info.height - 1; py++) {
      const d = colorDiff(gp(sx, py), gp(sx, py + 1));
      if (d > maxD) { maxD = d; maxPyTop = py; }
    }
    if (maxD > 40) { edgesWithBorder++; topBorderPositions.push(maxPyTop); }

    // Bottom edge
    totalEdges++;
    maxD = 0;
    let maxPyBot = ib;
    for (let py = ib; py < info.height - 1; py++) {
      const d = colorDiff(gp(sx, py), gp(sx, py + 1));
      if (d > maxD) { maxD = d; maxPyBot = py; }
    }
    if (maxD > 40) { edgesWithBorder++; bottomBorderPositions.push(maxPyBot); }

    // Left edge
    totalEdges++;
    maxD = 0;
    let maxPxLeft = 0;
    for (let px = 0; px < il && px < info.width - 1; px++) {
      const d = colorDiff(gp(px, sy), gp(px + 1, sy));
      if (d > maxD) { maxD = d; maxPxLeft = px; }
    }
    if (maxD > 40) { edgesWithBorder++; leftBorderPositions.push(maxPxLeft); }

    // Right edge
    totalEdges++;
    maxD = 0;
    let maxPxRight = ir;
    for (let px = ir; px < info.width - 1; px++) {
      const d = colorDiff(gp(px, sy), gp(px + 1, sy));
      if (d > maxD) { maxD = d; maxPxRight = px; }
    }
    if (maxD > 40) { edgesWithBorder++; rightBorderPositions.push(maxPxRight); }
  }

  const has_border = totalEdges > 0 && edgesWithBorder / totalEdges > 0.4;

  if (!has_border) {
    return { has_border: false, is_likely_button: false };
  }

  // Convert median border positions to original image coordinates
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

// ── Multi-entry border refinement ─────────────────────────────────────────────

/**
 * Run button detection on all entries, then apply multi-pass heuristics to
 * eliminate false positives (shared borders, container borders, long text).
 *
 * Returns a parallel array of `BorderResult` — one per entry.
 */
export async function detectButtons(
  colorImage: Buffer,
  entries: OcrEntry[],
  imgWidth: number,
  imgHeight: number,
): Promise<BorderResult[]> {
  // First pass: detect borders for every entry
  const borderData = await Promise.all(
    entries.map(async (entry) => {
      try {
        return await detectButtonHints(colorImage, entry, imgWidth, imgHeight);
      } catch {
        return { has_border: false, is_likely_button: false } as BorderResult;
      }
    }),
  );

  // Second pass: discard borders shared between adjacent blocks
  for (let i = 0; i < entries.length; i++) {
    if (!borderData[i].has_border) continue;

    const entry = entries[i];
    const margin = Math.max(entry.width, entry.height) * 0.3;

    for (let j = i + 1; j < entries.length; j++) {
      if (!borderData[j].has_border) continue;

      const other = entries[j];
      const dx = Math.abs(entry.center_x - other.center_x);
      const dy = Math.abs(entry.center_y - other.center_y);
      const avgW = (entry.width + other.width) / 2;
      const avgH = (entry.height + other.height) / 2;

      const adjacentHorizontally = dy < avgH && dx < avgW + margin;
      const adjacentVertically = dx < avgW && dy < avgH + margin;

      if (adjacentHorizontally || adjacentVertically) {
        const sharesBorder =
          (adjacentHorizontally && Math.abs(dy) < avgH * 0.8) ||
          (adjacentVertically && Math.abs(dx) < avgW * 0.8);

        if (sharesBorder) {
          borderData[i] = { has_border: false, is_likely_button: false };
          borderData[j] = { has_border: false, is_likely_button: false };
        }
      }
    }
  }

  // Third pass: propagate borders to vertically adjacent blocks in the same
  // container (e.g. heading + description inside one bordered box).
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
      if (vGap > 25) continue;

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

  // Collect groups and expand borders to cover every member
  const groups = new Map<number, number[]>();
  for (let i = 0; i < entries.length; i++) {
    if (groupId[i] !== -1) {
      if (!groups.has(groupId[i])) groups.set(groupId[i], []);
      groups.get(groupId[i])!.push(i);
    }
  }

  for (const [, members] of groups) {
    const borderedMembers = members.filter((idx) => borderData[idx].has_border);
    if (borderedMembers.length === 0) continue;

    let bx0: number | undefined, by0: number | undefined;
    let bx1: number | undefined, by1: number | undefined;
    for (const idx of borderedMembers) {
      const bd = borderData[idx];
      if (bd.border_x0 !== undefined) bx0 = bx0 !== undefined ? Math.min(bx0, bd.border_x0) : bd.border_x0;
      if (bd.border_y0 !== undefined) by0 = by0 !== undefined ? Math.min(by0, bd.border_y0) : bd.border_y0;
      if (bd.border_x1 !== undefined) bx1 = bx1 !== undefined ? Math.max(bx1, bd.border_x1) : bd.border_x1;
      if (bd.border_y1 !== undefined) by1 = by1 !== undefined ? Math.max(by1, bd.border_y1) : bd.border_y1;
    }

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

  // Fourth pass: if multiple blocks share identical border coordinates,
  // they're likely multiple text elements inside the same container.
  const borderSignatures = new Map<string, number[]>();
  for (let i = 0; i < entries.length; i++) {
    if (!borderData[i].has_border) continue;
    const sig = `${borderData[i].border_x0},${borderData[i].border_y0},${borderData[i].border_x1},${borderData[i].border_y1}`;
    if (!borderSignatures.has(sig)) borderSignatures.set(sig, []);
    borderSignatures.get(sig)!.push(i);
  }

  for (const [, indices] of borderSignatures) {
    if (indices.length > 1) {
      for (const idx of indices) {
        borderData[idx].is_likely_button = false;
      }
    }
  }

  return borderData;
}
