// BhayanakCast — seed data

const AVATARS = [
  { c1: 'oklch(0.85 0.18 85)', c2: 'oklch(0.7 0.2 30)' },
  { c1: 'oklch(0.8 0.17 220)', c2: 'oklch(0.65 0.2 280)' },
  { c1: 'oklch(0.82 0.2 145)', c2: 'oklch(0.7 0.18 190)' },
  { c1: 'oklch(0.82 0.19 20)', c2: 'oklch(0.7 0.17 350)' },
  { c1: 'oklch(0.82 0.17 305)', c2: 'oklch(0.7 0.2 250)' },
  { c1: 'oklch(0.85 0.15 65)', c2: 'oklch(0.75 0.15 120)' },
  { c1: 'oklch(0.75 0.18 180)', c2: 'oklch(0.65 0.18 240)' },
  { c1: 'oklch(0.85 0.15 45)', c2: 'oklch(0.65 0.2 15)' },
]

const avatarFor = (seed) => {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATARS[h % AVATARS.length]
}

const initials = (name) => {
  const parts = name
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const ROOM_SEED = [
  {
    id: 'r1',
    name: 'midnight speedrun club',
    slug: 'speedrun',
    streamer: 'kodama_jpg',
    viewers: 11,
    capacity: 15,
    tags: ['speedrun', 'retro', 'chill'],
    kind: 'gaming',
    started: '2h 14m',
    members: [
      'kodama_jpg',
      'bitreverb',
      'milo.draws',
      'nebula.wav',
      'render_farm',
      'pixel.rot',
      'sine.waver',
      'conveyor.belt',
      'lowpoly.lina',
      'theater_mode',
      'ferris.chan',
    ],
  },
  {
    id: 'r2',
    name: 'rust pair programming',
    slug: 'rust-pair',
    streamer: 'ferris.chan',
    viewers: 4,
    capacity: 10,
    tags: ['coding', 'rust', 'learning'],
    kind: 'code',
    started: '47m',
    members: ['ferris.chan', 'conveyor.belt', 'pixel.rot', 'lowpoly.lina'],
  },
  {
    id: 'r3',
    name: 'lo-fi jam sesh',
    slug: 'lofi',
    streamer: 'bitreverb',
    viewers: 8,
    capacity: 12,
    tags: ['music', 'chill', 'production'],
    kind: 'music',
    started: '1h 14m',
    members: [
      'bitreverb',
      'kodama_jpg',
      'milo.draws',
      'nebula.wav',
      'sine.waver',
      'render_farm',
      'theater_mode',
      'lowpoly.lina',
    ],
  },
  {
    id: 'r4',
    name: 'drawing monsters with milo',
    slug: 'monsters',
    streamer: 'milo.draws',
    viewers: 6,
    capacity: 10,
    tags: ['art', 'cozy'],
    kind: 'art',
    started: '1h 20m',
    members: [
      'milo.draws',
      'nebula.wav',
      'lowpoly.lina',
      'pixel.rot',
      'render_farm',
      'kodama_jpg',
    ],
  },
  {
    id: 'r5',
    name: 'movie night — dune pt2',
    slug: 'movie-night',
    streamer: 'theater_mode',
    viewers: 13,
    capacity: 15,
    tags: ['watch-party', 'chill'],
    kind: 'watch',
    started: '28m',
    members: [
      'theater_mode',
      'nebula.wav',
      'bitreverb',
      'kodama_jpg',
      'milo.draws',
      'ferris.chan',
      'conveyor.belt',
      'render_farm',
      'sine.waver',
      'pixel.rot',
      'lowpoly.lina',
      'wire.wolf',
      'crt.dream',
    ],
  },
  {
    id: 'r6',
    name: 'factorio megabase planning',
    slug: 'factorio',
    streamer: 'conveyor.belt',
    viewers: 5,
    capacity: 12,
    tags: ['gaming', 'strategy'],
    kind: 'gaming',
    started: '4h 11m',
    members: [
      'conveyor.belt',
      'ferris.chan',
      'pixel.rot',
      'sine.waver',
      'render_farm',
    ],
  },
  {
    id: 'r7',
    name: 'just vibing + taking Qs',
    slug: 'vibing',
    streamer: 'nebula.wav',
    viewers: 3,
    capacity: 10,
    tags: ['chat', 'hangout'],
    kind: 'chat',
    started: '12m',
    members: ['nebula.wav', 'milo.draws', 'lowpoly.lina'],
  },
  {
    id: 'r8',
    name: 'blender donut but cursed',
    slug: 'donut',
    streamer: 'render_farm',
    viewers: 7,
    capacity: 12,
    tags: ['3d', 'blender'],
    kind: 'art',
    started: '55m',
    members: [
      'render_farm',
      'milo.draws',
      'lowpoly.lina',
      'pixel.rot',
      'kodama_jpg',
      'bitreverb',
      'nebula.wav',
    ],
  },
]

// The full crew — 12 close friends
const CREW = [
  { id: 'u1', name: 'bitreverb', status: 'in-room', room: 'r3', you: false },
  { id: 'u2', name: 'kodama_jpg', status: 'in-room', room: 'r3', you: false },
  { id: 'u3', name: 'ferris.chan', status: 'in-room', room: 'r2', you: false },
  { id: 'u4', name: 'milo.draws', status: 'in-room', room: 'r3', you: false },
  { id: 'u5', name: 'you', status: 'online', room: null, you: true },
  { id: 'u6', name: 'nebula.wav', status: 'in-room', room: 'r5', you: false },
  { id: 'u7', name: 'conveyor.belt', status: 'online', room: null, you: false },
  { id: 'u8', name: 'render_farm', status: 'away', room: null, you: false },
  { id: 'u9', name: 'theater_mode', status: 'in-room', room: 'r5', you: false },
  { id: 'u10', name: 'sine.waver', status: 'offline', room: null, you: false },
  { id: 'u11', name: 'pixel.rot', status: 'offline', room: null, you: false },
  { id: 'u12', name: 'lowpoly.lina', status: 'online', room: null, you: false },
]

const ROOM_DETAIL = {
  id: 'r3',
  name: 'lo-fi jam sesh',
  participants: [
    {
      id: 'u1',
      name: 'bitreverb',
      role: 'streamer',
      streaming: true,
      speaking: true,
      muted: false,
      camera: true,
      you: false,
      size: 'l',
      screen: 'ableton',
    },
    {
      id: 'u2',
      name: 'kodama_jpg',
      role: 'streamer',
      streaming: true,
      speaking: false,
      muted: false,
      camera: true,
      you: false,
      size: 'm',
      screen: 'fl-studio',
    },
    {
      id: 'u4',
      name: 'milo.draws',
      role: 'member',
      streaming: false,
      speaking: true,
      muted: false,
      camera: true,
      you: false,
      size: 's',
    },
    {
      id: 'u5',
      name: 'you',
      role: 'member',
      streaming: false,
      speaking: false,
      muted: true,
      camera: false,
      you: true,
      size: 's',
    },
  ],
}

const CHAT_SEED = [
  {
    id: 'c1',
    user: 'kodama_jpg',
    role: 'streamer',
    ts: '20:14',
    text: 'yo yo yo welcome in',
  },
  {
    id: 'c2',
    user: 'milo.draws',
    role: 'member',
    ts: '20:14',
    text: 'the kick on that last loop is crunchy 🔥',
  },
  {
    id: 'c3',
    user: 'ferris.chan',
    role: 'mod',
    ts: '20:15',
    text: '@bitreverb can you bump the monitor a hair?',
  },
  {
    id: 'c4',
    user: 'bitreverb',
    role: 'streamer',
    ts: '20:15',
    text: 'ya on it — also swapping the reverb',
  },
  { id: 'c_sys1', system: true, text: 'nebula.wav joined' },
  {
    id: 'c5',
    user: 'nebula.wav',
    role: 'member',
    ts: '20:16',
    text: 'hiii sorry im late',
  },
  {
    id: 'c6',
    user: 'conveyor.belt',
    role: 'member',
    ts: '20:17',
    text: 'this pad is insane what vst',
  },
  {
    id: 'c7',
    user: 'bitreverb',
    role: 'streamer',
    ts: '20:17',
    text: 'serum — preset dump in #nom-nom-nom after',
  },
  {
    id: 'c8',
    user: 'kodama_jpg',
    role: 'streamer',
    ts: '20:18',
    text: 'bring back the 808 from earlier pls',
  },
  {
    id: 'c9',
    user: 'milo.draws',
    role: 'member',
    ts: '20:19',
    text: '+1 to that',
  },
]

const ACTIVITY = [
  { who: 'milo.draws', what: 'joined the room', when: 'just now' },
  { who: 'ferris.chan', what: 'started streaming', when: '2m ago' },
  { who: 'bitreverb', what: 'pinned a message', when: '6m ago' },
  { who: 'nebula.wav', what: 'reacted with 🔥', when: '8m ago' },
  { who: 'conveyor.belt', what: 'enabled DND mode', when: '14m ago' },
]

const SCREEN_KINDS = {
  ableton: { label: 'ABLETON LIVE 12', hue: 220 },
  'fl-studio': { label: 'FL STUDIO 24', hue: 305 },
  cli: { label: 'TERMINAL — cargo run', hue: 145 },
  browser: { label: 'CHROMIUM — figma.com', hue: 30 },
  game: { label: 'GAME CAPTURE', hue: 0 },
}

const PAST_ROOMS = [
  {
    id: 'p1',
    name: 'seven movie',
    streamer: 'theater_mode',
    started: '53m',
    members: ['theater_mode', 'kodama_jpg', 'nebula.wav'],
  },
  {
    id: 'p2',
    name: 'test',
    streamer: 'ferris.chan',
    started: '9m',
    members: ['ferris.chan', 'conveyor.belt'],
  },
  {
    id: 'p3',
    name: 'test movie',
    streamer: 'theater_mode',
    started: '1h',
    members: ['theater_mode', 'milo.draws', 'bitreverb'],
  },
  {
    id: 'p4',
    name: 'TEST',
    streamer: 'pixel.rot',
    started: '38m',
    members: ['pixel.rot'],
  },
  {
    id: 'p5',
    name: 'Test Quality',
    streamer: 'render_farm',
    started: '1h 3m',
    members: ['render_farm', 'bitreverb'],
  },
  {
    id: 'p6',
    name: 'League with Pako',
    streamer: 'lowpoly.lina',
    started: '1h 44m',
    members: ['lowpoly.lina', 'kodama_jpg'],
  },
]

// Per-user profile metadata, stats, and cotime matrix
const USER_PROFILES = {
  you: {
    username: 'you',
    discord: 'nelly#4021',
    joined: 'March 2024',
    stats: {
      hoursStreamed: 42.3,
      hoursWatched: 187.6,
      roomsHosted: 12,
      roomsJoined: 88,
      peakViewers: 14,
    },
  },
  kodama_jpg: {
    username: 'kodama_jpg',
    discord: 'kodama#1122',
    joined: 'Nov 2023',
    stats: {
      hoursStreamed: 214.8,
      hoursWatched: 302.1,
      roomsHosted: 48,
      roomsJoined: 156,
      peakViewers: 28,
    },
  },
  bitreverb: {
    username: 'bitreverb',
    discord: 'bitreverb#7410',
    joined: 'Jan 2024',
    stats: {
      hoursStreamed: 163.2,
      hoursWatched: 241.5,
      roomsHosted: 31,
      roomsJoined: 124,
      peakViewers: 22,
    },
  },
  'ferris.chan': {
    username: 'ferris.chan',
    discord: 'ferris#0420',
    joined: 'Aug 2023',
    stats: {
      hoursStreamed: 98.7,
      hoursWatched: 412.3,
      roomsHosted: 19,
      roomsJoined: 203,
      peakViewers: 11,
    },
  },
  'milo.draws': {
    username: 'milo.draws',
    discord: 'milo#3344',
    joined: 'Dec 2023',
    stats: {
      hoursStreamed: 76.4,
      hoursWatched: 189.0,
      roomsHosted: 22,
      roomsJoined: 97,
      peakViewers: 13,
    },
  },
  'nebula.wav': {
    username: 'nebula.wav',
    discord: 'nebula#8899',
    joined: 'Feb 2024',
    stats: {
      hoursStreamed: 34.1,
      hoursWatched: 156.7,
      roomsHosted: 8,
      roomsJoined: 112,
      peakViewers: 9,
    },
  },
  'conveyor.belt': {
    username: 'conveyor.belt',
    discord: 'conveyor#2020',
    joined: 'Oct 2023',
    stats: {
      hoursStreamed: 121.9,
      hoursWatched: 98.4,
      roomsHosted: 27,
      roomsJoined: 62,
      peakViewers: 17,
    },
  },
  render_farm: {
    username: 'render_farm',
    discord: 'render#5151',
    joined: 'Sept 2023',
    stats: {
      hoursStreamed: 88.2,
      hoursWatched: 134.8,
      roomsHosted: 16,
      roomsJoined: 78,
      peakViewers: 12,
    },
  },
  theater_mode: {
    username: 'theater_mode',
    discord: 'theater#9090',
    joined: 'Jul 2023',
    stats: {
      hoursStreamed: 302.5,
      hoursWatched: 521.2,
      roomsHosted: 64,
      roomsJoined: 201,
      peakViewers: 34,
    },
  },
  'sine.waver': {
    username: 'sine.waver',
    discord: 'sine#1313',
    joined: 'Jan 2024',
    stats: {
      hoursStreamed: 19.8,
      hoursWatched: 87.5,
      roomsHosted: 4,
      roomsJoined: 56,
      peakViewers: 7,
    },
  },
  'pixel.rot': {
    username: 'pixel.rot',
    discord: 'pixel#6677',
    joined: 'Nov 2023',
    stats: {
      hoursStreamed: 45.6,
      hoursWatched: 112.3,
      roomsHosted: 11,
      roomsJoined: 71,
      peakViewers: 10,
    },
  },
  'lowpoly.lina': {
    username: 'lowpoly.lina',
    discord: 'lina#2424',
    joined: 'Feb 2024',
    stats: {
      hoursStreamed: 67.3,
      hoursWatched: 201.8,
      roomsHosted: 14,
      roomsJoined: 119,
      peakViewers: 15,
    },
  },
}

// user_cotime.seconds_together — keyed by "user:other"; symmetric but stored one-way
const USER_COTIME = {
  'you:kodama_jpg': 48720,
  'you:bitreverb': 51300,
  'you:milo.draws': 39960,
  'you:nebula.wav': 28440,
  'you:ferris.chan': 22140,
  'you:theater_mode': 18600,
  'you:conveyor.belt': 14220,
  'you:render_farm': 9840,
  'you:lowpoly.lina': 7200,
  'you:pixel.rot': 4560,
  'you:sine.waver': 2400,

  'kodama_jpg:bitreverb': 92400,
  'kodama_jpg:milo.draws': 61200,
  'kodama_jpg:nebula.wav': 44400,
  'kodama_jpg:theater_mode': 38700,
  'kodama_jpg:ferris.chan': 27300,
  'kodama_jpg:conveyor.belt': 19800,
  'kodama_jpg:render_farm': 15600,
  'kodama_jpg:lowpoly.lina': 11400,
  'kodama_jpg:pixel.rot': 8400,

  'bitreverb:milo.draws': 54600,
  'bitreverb:nebula.wav': 49800,
  'bitreverb:theater_mode': 32400,
  'bitreverb:ferris.chan': 18000,
  'bitreverb:conveyor.belt': 12000,
  'bitreverb:render_farm': 22200,

  'ferris.chan:conveyor.belt': 71400,
  'ferris.chan:pixel.rot': 32400,
  'ferris.chan:render_farm': 19800,
  'ferris.chan:sine.waver': 14400,
  'ferris.chan:theater_mode': 8400,

  'milo.draws:nebula.wav': 38400,
  'milo.draws:lowpoly.lina': 42000,
  'milo.draws:pixel.rot': 26400,
  'milo.draws:render_farm': 31200,
  'milo.draws:theater_mode': 12600,

  'nebula.wav:theater_mode': 46800,
  'nebula.wav:lowpoly.lina': 18600,
  'nebula.wav:sine.waver': 9000,

  'theater_mode:lowpoly.lina': 29400,
  'theater_mode:render_farm': 22800,
  'conveyor.belt:pixel.rot': 24000,
  'conveyor.belt:sine.waver': 16200,
  'render_farm:pixel.rot': 15000,
  'render_farm:lowpoly.lina': 10800,
  'lowpoly.lina:pixel.rot': 6600,
  'sine.waver:pixel.rot': 3600,
}

const cotimeSeconds = (a, b) => {
  if (a === b) return 0
  return USER_COTIME[a + ':' + b] || USER_COTIME[b + ':' + a] || 0
}

const topCoUsers = (username, n = 5) => {
  const others = Object.keys(USER_PROFILES).filter((u) => u !== username)
  return others
    .map((u) => ({ username: u, seconds: cotimeSeconds(username, u) }))
    .filter((x) => x.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, n)
}

const formatCotime = (seconds) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return m + 'm'
  if (h < 10) return h + 'h ' + m + 'm'
  return h + 'h'
}

// Admin flag on current user
const CURRENT_USER_ADMIN = true

// User growth — new users per day (last 30 days)
const USER_GROWTH = (() => {
  const seed = [
    0, 1, 0, 2, 1, 0, 3, 1, 2, 1, 4, 2, 1, 3, 5, 2, 1, 3, 2, 4, 3, 2, 5, 3, 4,
    2, 3, 5, 4, 3,
  ]
  const out = []
  const start = new Date('2026-03-26')
  for (let i = 0; i < seed.length; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    out.push({
      date: d.toISOString().slice(5, 10),
      new_users: seed[i],
      cumulative: (out[i - 1]?.cumulative || 47) + seed[i],
    })
  }
  return out
})()

// Room activity — created/ended per day (last 30 days)
const ROOM_ACTIVITY = (() => {
  const created = [
    4, 6, 3, 7, 5, 8, 6, 9, 7, 5, 10, 8, 6, 11, 9, 7, 12, 8, 10, 9, 7, 13, 11,
    9, 14, 10, 8, 12, 15, 11,
  ]
  const ended = [
    3, 5, 4, 6, 5, 7, 5, 8, 6, 5, 9, 7, 6, 10, 8, 7, 11, 8, 9, 8, 7, 12, 10, 8,
    13, 9, 8, 11, 14, 10,
  ]
  const start = new Date('2026-03-26')
  return created.map((c, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return { date: d.toISOString().slice(5, 10), created: c, ended: ended[i] }
  })
})()

// All-time rooms — for admin table
const ALLTIME_ROOMS = [
  ...ROOM_SEED.map((r) => ({
    id: r.id,
    name: r.name,
    streamer: r.streamer,
    peak: r.viewers,
    joined: r.members.length,
    duration: r.started,
    status: 'live',
    ended: null,
  })),
  ...PAST_ROOMS.map((r) => ({
    id: r.id,
    name: r.name,
    streamer: r.streamer,
    peak: Math.max(2, r.members.length + 1),
    joined: r.members.length,
    duration: r.started,
    status: 'ended',
    ended: '2h ago',
  })),
  {
    id: 'h1',
    name: 'friday game night',
    streamer: 'kodama_jpg',
    peak: 12,
    joined: 14,
    duration: '3h 22m',
    status: 'ended',
    ended: '1d ago',
  },
  {
    id: 'h2',
    name: 'synth wave deep dive',
    streamer: 'bitreverb',
    peak: 9,
    joined: 10,
    duration: '1h 48m',
    status: 'ended',
    ended: '1d ago',
  },
  {
    id: 'h3',
    name: 'rust async internals',
    streamer: 'ferris.chan',
    peak: 6,
    joined: 8,
    duration: '2h 12m',
    status: 'ended',
    ended: '2d ago',
  },
  {
    id: 'h4',
    name: 'cozy watch: spirited away',
    streamer: 'theater_mode',
    peak: 14,
    joined: 15,
    duration: '2h 5m',
    status: 'ended',
    ended: '2d ago',
  },
  {
    id: 'h5',
    name: 'procgen experiments',
    streamer: 'render_farm',
    peak: 5,
    joined: 7,
    duration: '1h 30m',
    status: 'ended',
    ended: '3d ago',
  },
  {
    id: 'h6',
    name: 'figma teardown: linear',
    streamer: 'milo.draws',
    peak: 11,
    joined: 13,
    duration: '1h 12m',
    status: 'ended',
    ended: '3d ago',
  },
  {
    id: 'h7',
    name: 'keyboard ergo chat',
    streamer: 'lowpoly.lina',
    peak: 4,
    joined: 5,
    duration: '42m',
    status: 'ended',
    ended: '4d ago',
  },
  {
    id: 'h8',
    name: 'factorio coop saturday',
    streamer: 'conveyor.belt',
    peak: 8,
    joined: 10,
    duration: '4h 3m',
    status: 'ended',
    ended: '5d ago',
  },
  {
    id: 'h9',
    name: 'nebula plays outer wilds',
    streamer: 'nebula.wav',
    peak: 7,
    joined: 9,
    duration: '2h 40m',
    status: 'ended',
    ended: '6d ago',
  },
  {
    id: 'h10',
    name: 'terminal dotfile party',
    streamer: 'ferris.chan',
    peak: 6,
    joined: 7,
    duration: '1h 20m',
    status: 'ended',
    ended: '7d ago',
  },
]

Object.assign(window, {
  AVATARS,
  avatarFor,
  initials,
  ROOM_SEED,
  ROOM_DETAIL,
  CHAT_SEED,
  ACTIVITY,
  SCREEN_KINDS,
  CREW,
  PAST_ROOMS,
  USER_PROFILES,
  USER_COTIME,
  cotimeSeconds,
  topCoUsers,
  formatCotime,
  CURRENT_USER_ADMIN,
  USER_GROWTH,
  ROOM_ACTIVITY,
  ALLTIME_ROOMS,
})
