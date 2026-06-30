export type Thumbnail = {
  contentType: 'image/webp' | 'image/jpeg'
  bytes: Buffer
}

const thumbnails: Record<string, Thumbnail> = {}

export function setThumbnail(streamSessionId: string, thumbnail: Thumbnail) {
  thumbnails[streamSessionId] = thumbnail
}

export function getThumbnail(streamSessionId: string) {
  return thumbnails[streamSessionId]
}

export function deleteThumbnail(streamSessionId: string) {
  delete thumbnails[streamSessionId]
}
