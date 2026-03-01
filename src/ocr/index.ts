// Re-export the public API of the OCR module.
export { type OcrEntry, type OcrSearchEntry, type BboxItem, toEntry, toSearchEntry } from "./types.js";
export { preprocessForOcr } from "./image-preprocessing.js";
export { normalizeText, normalizeForMatch } from "./text-utils.js";
export { clusterWords } from "./word-clustering.js";
export { type BorderResult, detectButtonHints, detectButtons } from "./button-detection.js";
