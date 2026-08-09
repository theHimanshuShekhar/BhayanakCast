import { describe, expect, it, vi } from 'vitest'
import {
  applyStreamEncodingContract,
  markStreamTracksAsMotion,
  STREAM_CAPTURE_CONSTRAINTS,
} from '../../src/features/room/useRoomMedia'

describe('Stream encoding contract', () => {
  it('requests audio and motion-first 1080p60 capture ceilings', () => {
    expect(STREAM_CAPTURE_CONSTRAINTS).toEqual({
      video: {
        frameRate: { ideal: 60 },
        width: { max: 1920 },
        height: { max: 1080 },
      },
      audio: true,
    })
    expect(STREAM_CAPTURE_CONSTRAINTS.video.width).not.toHaveProperty('ideal')
    expect(STREAM_CAPTURE_CONSTRAINTS.video.width).not.toHaveProperty('exact')
    expect(STREAM_CAPTURE_CONSTRAINTS.video.height).not.toHaveProperty('ideal')
    expect(STREAM_CAPTURE_CONSTRAINTS.video.height).not.toHaveProperty('exact')
  })

  it('marks only captured video tracks as motion content', () => {
    const videoTracks = [{ contentHint: '' }, { contentHint: 'detail' }]
    const audioTrack = { contentHint: 'speech' }
    const stream = { getVideoTracks: () => videoTracks, audioTrack }

    expect(markStreamTracksAsMotion(stream)).toBe(stream)
    expect(videoTracks).toEqual([{ contentHint: 'motion' }, { contentHint: 'motion' }])
    expect(audioTrack.contentHint).toBe('speech')
  })

  it('adds a flat 8 Mbit ceiling while preserving sender encodings', async () => {
    const parameters: RTCRtpSendParameters = {
      transactionId: 'existing-transaction',
      codecs: [],
      headerExtensions: [],
      rtcp: { cname: 'existing-cname', reducedSize: true },
      encodings: [
        { rid: 'primary', active: true, scaleResolutionDownBy: 1 },
        { rid: 'secondary', active: false, maxBitrate: 125_000 },
      ],
    }
    const encodings = parameters.encodings
    const setParameters = vi.fn(async (_parameters: RTCRtpSendParameters) => {})
    const sender = { getParameters: () => parameters, setParameters }

    await applyStreamEncodingContract(sender)

    expect(parameters.degradationPreference).toBe('maintain-framerate')
    expect(parameters.encodings).toBe(encodings)
    expect(parameters.encodings).toEqual([
      { rid: 'primary', active: true, scaleResolutionDownBy: 1, maxBitrate: 8_000_000 },
      { rid: 'secondary', active: false, maxBitrate: 8_000_000 },
    ])
    expect(setParameters).toHaveBeenCalledOnce()
    expect(setParameters).toHaveBeenCalledWith(parameters)
  })

  it('does not fabricate sender encodings', async () => {
    const parameters: RTCRtpSendParameters = {
      transactionId: 'no-encodings',
      codecs: [],
      headerExtensions: [],
      rtcp: { cname: 'existing-cname', reducedSize: true },
      encodings: [],
    }
    const setParameters = vi.fn(async (_parameters: RTCRtpSendParameters) => {})

    await applyStreamEncodingContract({ getParameters: () => parameters, setParameters })

    expect(setParameters).not.toHaveBeenCalled()
    expect(parameters).not.toHaveProperty('degradationPreference')
  })
})
