import type { BrowserContext } from '@playwright/test'

export async function installWebRtcProbe(
  context: BrowserContext,
  firstProbe: 'pass' | 'fail',
) {
  await context.addInitScript(({ firstProbe }) => {
    let watchAttempts = 0
    const mediaDevices = navigator.mediaDevices ?? {}
    Object.defineProperty(mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => {
        throw new DOMException('Browser picker cancelled', 'NotAllowedError')
      },
    })
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: mediaDevices,
      })
    }
    class FakePeerConnection {
      private watchAttempt = 0
      connectionState = 'new'
      onconnectionstatechange: (() => void) | null = null
      onicecandidate: (() => void) | null = null
      ontrack: ((event: RTCTrackEvent) => void) | null = null
      addTransceiver(kind: string) {
        if (kind === 'audio' && this.watchAttempt === 0) this.watchAttempt = ++watchAttempts
      }
      close() {}
      addIceCandidate() {
        return Promise.resolve()
      }
      createOffer() {
        const fails =
          firstProbe === 'fail'
            ? (window as typeof window & { failCompatibilityProbe?: boolean })
                .failCompatibilityProbe !== false
            : this.watchAttempt > 0 && this.watchAttempt <= 4
        if (fails) return Promise.reject(new Error('direct peer unavailable'))
        return Promise.resolve({ type: 'offer', sdp: 'compatibility-probe' })
      }
      getSenders() {
        return []
      }
      setLocalDescription() {
        if (firstProbe === 'pass' && this.watchAttempt > 4) {
          queueMicrotask(() =>
            this.ontrack?.({ streams: [new MediaStream()] } as unknown as RTCTrackEvent),
          )
        }
        return Promise.resolve()
      }
      setRemoteDescription() {
        return Promise.resolve()
      }
    }
    Object.defineProperty(window, 'RTCPeerConnection', {
      configurable: true,
      value: FakePeerConnection,
    })
  }, { firstProbe })
}
