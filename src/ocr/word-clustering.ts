import type Tesseract from "tesseract.js";
import type { OcrEntry } from "./types.js";
import { toEntry } from "./types.js";

/**
 * Cluster word-level OCR results into spatially grouped phrases.
 *
 * Words on the same row that are close together horizontally are merged;
 * a large horizontal gap (> 1.5× avg word height) starts a new cluster.
 * This isolates visually distinct UI elements (buttons, labels, links).
 */
export function clusterWords(blocks: Tesseract.Block[]): OcrEntry[] {
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
