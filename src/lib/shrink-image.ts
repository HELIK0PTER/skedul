import {
  ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  MAX_IMAGE_EDGE,
  fitWithin,
} from "@/lib/support";

/**
 * Browser only (canvas): re-encodes a picked screenshot so it fits
 * MAX_ATTACHMENT_BYTES, because Vercel caps request bodies at 4.5 MB and the
 * images travel in the Server Action's FormData. Small png/jpg/webp files are
 * sent untouched.
 */

const UNREADABLE = "Impossible de lire cette image.";
const QUALITIES = [0.85, 0.75, 0.6];
const LAST_TRY = { edge: 1400, quality: 0.7 };

type OutputType = "image/webp" | "image/jpeg";

function draw(bitmap: ImageBitmap, maxEdge: number, type: OutputType): HTMLCanvasElement {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(UNREADABLE);
  if (type === "image/jpeg") {
    // JPEG has no transparency: paint it white rather than black
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

function encode(canvas: HTMLCanvasElement, type: OutputType, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(UNREADABLE))), type, quality);
  });
}

export async function shrinkImage(file: File): Promise<File> {
  if (file.size <= MAX_ATTACHMENT_BYTES && Object.hasOwn(ATTACHMENT_EXTENSIONS, file.type)) {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(UNREADABLE);
  }
  try {
    let type: OutputType = "image/webp";
    let canvas = draw(bitmap, MAX_IMAGE_EDGE, type);
    let blob = await encode(canvas, type, QUALITIES[0]);
    if (blob.type !== type) {
      // no WebP encoder in this browser (it answered with a PNG): use JPEG
      type = "image/jpeg";
      canvas = draw(bitmap, MAX_IMAGE_EDGE, type);
      blob = await encode(canvas, type, QUALITIES[0]);
    }
    for (const quality of QUALITIES.slice(1)) {
      if (blob.size <= MAX_ATTACHMENT_BYTES) break;
      blob = await encode(canvas, type, quality);
    }
    if (blob.size > MAX_ATTACHMENT_BYTES) {
      blob = await encode(draw(bitmap, LAST_TRY.edge, type), type, LAST_TRY.quality);
    }
    const base = file.name.replace(/\.[^.]*$/, "") || "capture";
    return new File([blob], `${base}.${ATTACHMENT_EXTENSIONS[type]}`, { type: blob.type });
  } finally {
    bitmap.close();
  }
}
