export interface ImageDimensions {
  width: number
  height: number
}

/** 等比限制图片长边，避免上传和解码手机原始大图。 */
export const fitImageWithin = (
  width: number,
  height: number,
  maxEdge: number,
): ImageDimensions => {
  if (width <= 0 || height <= 0 || maxEdge <= 0) return { width, height }
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}
