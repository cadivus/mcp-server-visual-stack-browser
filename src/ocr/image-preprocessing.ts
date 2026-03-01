import sharp from "sharp";

/**
 * Preprocess an image for better OCR on both normal and light-on-dark text
 * (e.g. white text on blue buttons).
 *
 * Returns two versions:
 * - `original` — grayscale + normalized for standard dark-on-light text
 * - `inverted` — grayscale, negated, sharpened for light-on-dark text
 *
 * Running OCR on both and merging results catches text that either pass alone
 * would miss.
 */
export async function preprocessForOcr(
  imageBuffer: Buffer,
): Promise<{ original: Buffer; inverted: Buffer }> {
  const original = await sharp(imageBuffer)
    .grayscale()
    .normalize()
    .toBuffer();

  const inverted = await sharp(imageBuffer)
    .grayscale()
    .negate()
    .normalize()
    .sharpen()
    .toBuffer();

  return { original, inverted };
}
