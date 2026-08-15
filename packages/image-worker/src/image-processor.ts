import sharp from "sharp";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const DERIVATIVE_WIDTHS = [480, 960, 1600] as const;
export type SupportedImageType = "image/jpeg" | "image/png" | "image/webp";
export interface ImageDerivative { readonly body: Buffer; readonly contentType: "image/webp"; readonly height: number; readonly width: number }

export class ImageValidationError extends Error {
  constructor(readonly code: string) { super("La imagen no pudo validarse para procesamiento."); this.name = "ImageValidationError"; }
}

const detectedType = (body: Buffer): SupportedImageType | undefined => {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (body.length >= 12 && body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined;
};

const watermark = (width: number): Buffer => {
  const markWidth = Math.max(120, Math.round(width * 0.28));
  const markHeight = Math.max(38, Math.round(markWidth * 0.28));
  const fontSize = Math.max(18, Math.round(markHeight * 0.42));
  return Buffer.from(`<svg width="${markWidth}" height="${markHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="8" fill="#101820" fill-opacity="0.62"/><text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" fill-opacity="0.88" font-family="sans-serif" font-size="${fontSize}" font-weight="700">GYM ADR</text></svg>`);
};

export const processGalleryImage = async (body: Buffer, declaredType: string | undefined): Promise<readonly ImageDerivative[]> => {
  if (body.length < 1 || body.length > MAX_IMAGE_BYTES) throw new ImageValidationError("INVALID_SIZE");
  const actualType = detectedType(body);
  if (actualType === undefined || actualType !== declaredType) throw new ImageValidationError("INVALID_MIME");
  try {
    const metadata = await sharp(body, { failOn: "error", limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
    if (metadata.width === undefined || metadata.height === undefined || metadata.width * metadata.height > MAX_IMAGE_PIXELS) throw new ImageValidationError("INVALID_DIMENSIONS");
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError("CORRUPT_IMAGE");
  }
  const derivatives: ImageDerivative[] = [];
  for (const targetWidth of DERIVATIVE_WIDTHS) {
    try {
      const normalized = await sharp(body, { failOn: "error", limitInputPixels: MAX_IMAGE_PIXELS }).rotate().resize({ fit: "inside", height: targetWidth, width: targetWidth, withoutEnlargement: true }).webp({ effort: 4, quality: 82 }).toBuffer({ resolveWithObject: true });
      const watermarked = await sharp(normalized.data).composite([{ input: watermark(normalized.info.width), gravity: "southeast" }]).webp({ effort: 4, quality: 82 }).toBuffer({ resolveWithObject: true });
      derivatives.push({ body: watermarked.data, contentType: "image/webp", height: watermarked.info.height, width: watermarked.info.width });
    } catch { throw new ImageValidationError("CORRUPT_IMAGE"); }
  }
  return derivatives;
};
