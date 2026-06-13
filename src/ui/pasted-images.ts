import type { ImageContent } from "@earendil-works/pi-ai";

export const MAX_PASTED_IMAGES = 10;
export const MAX_PASTED_IMAGE_BYTES = 20 * 1024 * 1024;

export interface PastedImage {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  data: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }

  return btoa(chunks.join(""));
}

export async function readPastedImage(file: File, index: number): Promise<PastedImage> {
  if (!file.type.toLowerCase().startsWith("image/")) {
    throw new Error("Only images can be pasted into chat.");
  }

  if (file.size > MAX_PASTED_IMAGE_BYTES) {
    throw new Error("Pasted images must be 20 MB or smaller.");
  }

  const mimeType = file.type.toLowerCase();
  const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const fileName = file.name && file.name !== "image.png"
    ? file.name
    : `pasted-image-${index + 1}.${extension}`;

  return {
    id: `${Date.now()}-${index}-${file.size}`,
    fileName,
    mimeType,
    size: file.size,
    data: arrayBufferToBase64(await file.arrayBuffer()),
  };
}

export function toImageContent(images: readonly PastedImage[]): ImageContent[] {
  return images.map((image) => ({
    type: "image",
    data: image.data,
    mimeType: image.mimeType,
  }));
}
