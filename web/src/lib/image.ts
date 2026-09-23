/**
 * Re-encodes a camera photo on the device before upload:
 *  - resizes to at most `maxSide` px (smaller payload, less detail than needed is never kept);
 *  - re-encoding through a canvas drops every EXIF field, including GPS position and device model.
 */
export async function compressPhoto(file: File, maxSide = 1600, quality = 0.8): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}
