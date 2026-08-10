interface PastStreamMediaProps {
  readonly className?: string
  readonly roomId: string
  readonly streamCount: number
  readonly thumbnailCapturedAt?: Date | string | null
  readonly visibility: 'public' | 'private'
}

export function PastStreamMedia({
  className,
  roomId,
  streamCount,
  thumbnailCapturedAt,
  visibility,
}: PastStreamMediaProps) {
  const classes = `past-stream-item__media${className ? ` ${className}` : ''}`
  if (visibility === 'public' && thumbnailCapturedAt) {
    const capturedAt =
      thumbnailCapturedAt instanceof Date
        ? thumbnailCapturedAt.toISOString()
        : thumbnailCapturedAt
    return (
      <span aria-hidden="true" className={classes}>
        <img
          alt=""
          decoding="async"
          height={360}
          loading="lazy"
          sizes="(min-width: 48rem) 20rem, 100vw"
          src={`/api/past-stream-previews/${encodeURIComponent(roomId)}?capturedAt=${encodeURIComponent(capturedAt)}`}
          srcSet={`/api/past-stream-previews/${encodeURIComponent(roomId)}?capturedAt=${encodeURIComponent(capturedAt)} 640w`}
          width={640}
        />
      </span>
    )
  }
  if (visibility === 'private' && streamCount > 0) {
    return (
      <span
        aria-hidden="true"
        className={`${classes} past-stream-item__media--private`}
      />
    )
  }
  return null
}
