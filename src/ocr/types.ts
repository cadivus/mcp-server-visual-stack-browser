import type Tesseract from "tesseract.js";

/** A single OCR-detected text element with position and size. */
export interface OcrEntry {
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

/** A search match returned by the OCR search tool. */
export interface OcrSearchEntry {
  phrase: string;
  granularity: string;
  center_x: number;
  center_y: number;
}

/** An OCR word/line/block with its bounding box for coordinate calculations. */
export type BboxItem = { text: string; confidence: number; bbox: Tesseract.Bbox };

/**
 * Convert a BboxItem into an OcrEntry (coordinates + dimensions).
 */
export function toEntry(item: BboxItem): OcrEntry {
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

/**
 * Convert a BboxItem into an OcrSearchEntry (for search results).
 */
export function toSearchEntry(item: BboxItem, granularity: string): OcrSearchEntry {
  const { x0, y0, x1, y1 } = item.bbox;
  return {
    phrase: item.text.trim(),
    granularity,
    center_x: Math.round((x0 + x1) / 2),
    center_y: Math.round((y0 + y1) / 2),
  };
}
