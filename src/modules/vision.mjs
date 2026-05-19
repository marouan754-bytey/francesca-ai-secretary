export function prepareVisionPart(data, mimeType) {
  if (!data) return null;
  const base64Data = Buffer.isBuffer(data) ? data.toString('base64') : data;
  let cleanMime = mimeType || 'image/jpeg';
  if (cleanMime.includes('audio')) cleanMime = 'audio/ogg';
  return { inlineData: { data: base64Data, mimeType: cleanMime } };
}

export function sanitizeParts(parts) {
  if (!parts || !Array.isArray(parts)) return [{ text: '' }];
  return parts
    .map((p) => {
      if (p.text) return { text: String(p.text) };
      const data = p.inlineData?.data || p.imageBuffer || p.audioBuffer || p.buffer;
      const mime = p.inlineData?.mimeType || p.mimetype || p.mimeType;
      if (data && mime) return prepareVisionPart(data, mime);
      return null;
    })
    .filter((p) => p !== null);
}
