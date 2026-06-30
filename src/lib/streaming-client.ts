export const thumbnailIntervalMs = 120_000

export function canShareScreen(
  mediaDevices: Pick<MediaDevices, 'getDisplayMedia'> | undefined,
) {
  return typeof mediaDevices?.getDisplayMedia === 'function'
}

export function streamTrackSummary(stream: MediaStream) {
  return {
    hasVideo: stream.getVideoTracks().length > 0,
    hasAudio: stream.getAudioTracks().length > 0,
    displaySurface: stream.getVideoTracks()[0]?.getSettings().displaySurface,
    label: stream.getVideoTracks()[0]?.label,
  }
}
