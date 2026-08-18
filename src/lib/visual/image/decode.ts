/**
 * BROWSER DECODE BOUNDARY — File/Blob -> RgbaImage.
 *
 * The only impure module of the image package. Everything is local: the file is
 * decoded with `createImageBitmap` and drawn into an offscreen canvas. No upload,
 * no network, no pixels ever leave the tab or get persisted.
 */
import {
  ImageAnalysisError,
  IMAGE_ACCEPTED_TYPES,
  IMAGE_ANALYSIS_MAX_EDGE,
  IMAGE_MAX_EDGE,
  IMAGE_MAX_FILE_BYTES,
  IMAGE_MAX_PIXELS,
  type RgbaImage,
} from "./types";

export interface DecodedImage {
  /** Already downscaled to the analysis long edge. */
  readonly image: RgbaImage;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly decodeMs: number;
  /** Object URL for the REFERENCE preview. Caller must revoke it. */
  readonly previewUrl: string;
}

export function assertAcceptableFile(file: File): void {
  if (!(IMAGE_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    throw new ImageAnalysisError("UNSUPPORTED_TYPE", "Unsupported image type", {
      type: file.type,
      accepted: IMAGE_ACCEPTED_TYPES,
    });
  }
  if (file.size > IMAGE_MAX_FILE_BYTES) {
    throw new ImageAnalysisError("FILE_TOO_LARGE", "Image file is too large", {
      size: file.size,
      max: IMAGE_MAX_FILE_BYTES,
    });
  }
}

function createCanvas(width: number, height: number): {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new ImageAnalysisError("DECODE_FAILED", "2D context unavailable");
    return { ctx: ctx as OffscreenCanvasRenderingContext2D };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new ImageAnalysisError("DECODE_FAILED", "2D context unavailable");
  return { ctx };
}

export async function decodeImageFile(file: File): Promise<DecodedImage> {
  assertAcceptableFile(file);
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    throw new ImageAnalysisError("DECODE_FAILED", "The image could not be decoded", {
      reason: String(error),
    });
  }

  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  try {
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      throw new ImageAnalysisError("EMPTY_IMAGE", "The image has no pixels");
    }
    if (sourceWidth > IMAGE_MAX_EDGE || sourceHeight > IMAGE_MAX_EDGE) {
      throw new ImageAnalysisError("DIMENSIONS_TOO_LARGE", "Image dimensions are too large", {
        width: sourceWidth,
        height: sourceHeight,
        max: IMAGE_MAX_EDGE,
      });
    }
    if (sourceWidth * sourceHeight > IMAGE_MAX_PIXELS) {
      throw new ImageAnalysisError("PIXELS_TOO_LARGE", "Image has too many pixels", {
        pixels: sourceWidth * sourceHeight,
        max: IMAGE_MAX_PIXELS,
      });
    }

    // Draw straight to the analysis resolution: the browser resampler is fast
    // and the pure box downscale in luminance.ts handles any remaining excess.
    const longEdge = Math.max(sourceWidth, sourceHeight);
    const scale = Math.min(1, IMAGE_ANALYSIS_MAX_EDGE / longEdge);
    const w = Math.max(1, Math.round(sourceWidth * scale));
    const h = Math.max(1, Math.round(sourceHeight * scale));
    const { ctx } = createCanvas(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const decodeMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
    return {
      image: { width: w, height: h, data: imageData.data },
      sourceWidth,
      sourceHeight,
      decodeMs: Number(decodeMs.toFixed(2)),
      previewUrl: URL.createObjectURL(file),
    };
  } finally {
    bitmap.close?.();
  }
}
