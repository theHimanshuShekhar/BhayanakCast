// Seed data ported from docs/design/prototype/data.jsx, adjusted to ADR 2 limits
// (10 people, 3 streamers per room). Replaced by server functions once the DB layer lands.
import { MAX_STREAMERS, ROOM_CAPACITY } from "./format";
import type {
  ActivityItem,
  AllTimeRoom,
  ChatMessage,
  CoUser,
  LiveRoom,
  Participant,
  PastRoom,
  RoomActivityPoint,
  RoomDetail,
  Stream,
  UserGrowthPoint,
  UserProfile,
} from "./types";

export const CURRENT_USER = "nelly.jpg";
export const CURRENT_USER_ADMIN = true;

type RoomSeed = Omit<LiveRoom, "viewers" | "capacity" | "streams">;

const ROOM_SEED: RoomSeed[] = [
  {
    id: "r1",
    name: "midnight speedrun club",
    streamer: "kodama_jpg",
    tags: ["speedrun", "retro", "chill"],
    kind: "gaming",
    started: "2h 14m",
    members: [
      "kodama_jpg",
      "bitreverb",
      "milo.draws",
      "nebula.wav",
      "render_farm",
      "pixel.rot",
      "sine.waver",
      "conveyor.belt",
      "lowpoly.lina",
    ],
  },
  {
    id: "r2",
    name: "rust pair programming",
    streamer: "ferris.chan",
    tags: ["coding", "rust", "learning"],
    kind: "code",
    started: "47m",
    members: ["ferris.chan", "conveyor.belt", "pixel.rot", "lowpoly.lina"],
  },
  {
    id: "r3",
    name: "lo-fi jam sesh",
    streamer: "bitreverb",
    tags: ["music", "chill", "production"],
    kind: "music",
    started: "1h 14m",
    members: [
      "bitreverb",
      "kodama_jpg",
      "milo.draws",
      "nebula.wav",
      "sine.waver",
      "render_farm",
      "theater_mode",
      "lowpoly.lina",
    ],
  },
  {
    id: "r4",
    name: "drawing monsters with milo",
    streamer: "milo.draws",
    tags: ["art", "cozy"],
    kind: "art",
    started: "1h 20m",
    members: ["milo.draws", "nebula.wav", "lowpoly.lina", "pixel.rot", "render_farm", "kodama_jpg"],
  },
  {
    id: "r5",
    name: "movie night — dune pt2",
    streamer: "theater_mode",
    tags: ["watch-party", "chill"],
    kind: "watch",
    started: "28m",
    members: [
      "theater_mode",
      "nebula.wav",
      "bitreverb",
      "kodama_jpg",
      "milo.draws",
      "ferris.chan",
      "conveyor.belt",
      "render_farm",
      "sine.waver",
      "pixel.rot",
    ],
  },
  {
    id: "r6",
    name: "factorio megabase planning",
    streamer: "conveyor.belt",
    tags: ["gaming", "strategy"],
    kind: "gaming",
    started: "4h 11m",
    members: ["conveyor.belt", "ferris.chan", "pixel.rot", "sine.waver", "render_farm"],
  },
  {
    id: "r7",
    name: "just vibing + taking Qs",
    streamer: "nebula.wav",
    tags: ["chat", "hangout"],
    kind: "chat",
    started: "12m",
    members: ["nebula.wav", "milo.draws", "lowpoly.lina"],
  },
  {
    id: "r8",
    name: "blender donut but cursed",
    streamer: "render_farm",
    tags: ["3d", "blender"],
    kind: "art",
    started: "55m",
    members: [
      "render_farm",
      "milo.draws",
      "lowpoly.lina",
      "pixel.rot",
      "kodama_jpg",
      "bitreverb",
      "nebula.wav",
    ],
  },
];

const ROOM_STREAMS: Record<string, Stream[]> = {
  r1: [
    { user: "kodama_jpg", screen: "game" },
    { user: "bitreverb", screen: "game" },
    { user: "pixel.rot", screen: "browser" },
  ],
  r2: [
    { user: "ferris.chan", screen: "cli" },
    { user: "conveyor.belt", screen: "cli" },
  ],
  r3: [
    { user: "bitreverb", screen: "ableton" },
    { user: "kodama_jpg", screen: "fl-studio" },
    { user: "sine.waver", screen: "ableton" },
  ],
  r4: [{ user: "milo.draws", screen: "browser" }],
  r5: [{ user: "theater_mode", screen: "game" }],
  r6: [
    { user: "conveyor.belt", screen: "game" },
    { user: "ferris.chan", screen: "browser" },
    { user: "pixel.rot", screen: "cli" },
  ],
  r7: [{ user: "nebula.wav", screen: "browser" }],
  r8: [
    { user: "render_farm", screen: "browser" },
    { user: "lowpoly.lina", screen: "ableton" },
  ],
};

export const LIVE_ROOMS: LiveRoom[] = ROOM_SEED.map((r) => ({
  ...r,
  viewers: r.members.length,
  capacity: ROOM_CAPACITY,
  streams: (ROOM_STREAMS[r.id] ?? [{ user: r.streamer, screen: "browser" }]).slice(
    0,
    MAX_STREAMERS,
  ),
}));

export const ONLINE_COUNT = 9;

const CHAT_SEED: ChatMessage[] = [
  { id: "c1", user: "kodama_jpg", role: "member", ts: "20:14", text: "yo yo yo welcome in" },
  {
    id: "c2",
    user: "milo.draws",
    role: "member",
    ts: "20:14",
    text: "the kick on that last loop is crunchy 🔥",
  },
  {
    id: "c3",
    user: "ferris.chan",
    role: "mod",
    ts: "20:15",
    text: "@bitreverb can you bump the monitor a hair?",
  },
  {
    id: "c4",
    user: "bitreverb",
    role: "member",
    ts: "20:15",
    text: "ya on it — also swapping the reverb",
  },
  { id: "c_sys1", system: true, text: "nebula.wav joined" },
  { id: "c5", user: "nebula.wav", role: "member", ts: "20:16", text: "hiii sorry im late" },
  {
    id: "c6",
    user: "conveyor.belt",
    role: "member",
    ts: "20:17",
    text: "this pad is insane what vst",
  },
  {
    id: "c7",
    user: "bitreverb",
    role: "member",
    ts: "20:17",
    text: "serum — preset dump in #nom-nom-nom after",
  },
  {
    id: "c8",
    user: "kodama_jpg",
    role: "member",
    ts: "20:18",
    text: "bring back the 808 from earlier pls",
  },
  { id: "c9", user: "milo.draws", role: "member", ts: "20:19", text: "+1 to that" },
];

export const ACTIVITY: ActivityItem[] = [
  { who: "milo.draws", what: "joined the room", when: "just now" },
  { who: "ferris.chan", what: "started streaming", when: "2m ago" },
  { who: "bitreverb", what: "was promoted to mod", when: "6m ago" },
  { who: "nebula.wav", what: "reacted with 🔥", when: "8m ago" },
  { who: "conveyor.belt", what: "stopped streaming", when: "14m ago" },
];

// Build a room's live detail from its card record so every room opens its own people/streams.
export const buildRoomDetail = (r: LiveRoom): RoomDetail => {
  const streams = r.streams.slice(0, MAX_STREAMERS);
  const streamUsers = streams.map((s) => s.user);
  const others = r.members.filter((n) => !streamUsers.includes(n) && n !== CURRENT_USER);
  const participants: Participant[] = [
    ...streams.map(
      (s, i): Participant => ({
        id: `s${i}`,
        name: s.user,
        role: s.user === r.streamer ? "host" : "member",
        streaming: true,
        speaking: i === 0,
        muted: false,
        camera: i < 2,
        size: i === 0 ? "l" : "m",
        screen: s.screen,
        you: s.user === CURRENT_USER,
      }),
    ),
    ...others.slice(0, 2).map(
      (n, i): Participant => ({
        id: `c${i}`,
        name: n,
        role: i === 0 ? "mod" : "member",
        streaming: false,
        speaking: i === 1,
        muted: i !== 1,
        camera: true,
        size: "s",
      }),
    ),
    ...others.slice(2).map(
      (n, i): Participant => ({
        id: `v${i}`,
        name: n,
        role: "member",
        streaming: false,
        speaking: false,
        muted: true,
        camera: false,
        viewerOnly: true,
      }),
    ),
  ];
  if (!streamUsers.includes(CURRENT_USER)) {
    participants.push({
      id: "me",
      name: CURRENT_USER,
      role: "member",
      streaming: false,
      speaking: false,
      muted: true,
      camera: false,
      you: true,
      viewerOnly: true,
    });
  }
  if (!streamUsers.includes(r.streamer) && r.streamer !== CURRENT_USER) {
    participants.unshift({
      id: "h",
      name: r.streamer,
      role: "host",
      streaming: false,
      speaking: false,
      muted: false,
      camera: true,
      size: "m",
    });
  }
  const pool = participants.filter((p) => !p.you && p.name !== r.streamer).map((p) => p.name);
  // a freshly created room has nobody to have chatted yet
  if (!pool.length)
    return {
      id: r.id,
      name: r.name,
      host: r.streamer,
      capacity: r.capacity,
      participants,
      chat: [],
    };
  const map = new Map<string, string>();
  let k = 0;
  const chat = CHAT_SEED.map((m): ChatMessage => {
    if (m.system) return { ...m, text: m.text.replace(/^\S+/, pool[pool.length - 1] ?? "someone") };
    let user = map.get(m.user);
    if (!user) {
      user = m.user === "kodama_jpg" ? r.streamer : (pool[k++ % pool.length] ?? r.streamer);
      map.set(m.user, user);
    }
    return { ...m, user, text: m.text.replace(/@(\w+)/g, () => `@${pool[0] ?? r.streamer}`) };
  });
  return { id: r.id, name: r.name, host: r.streamer, capacity: r.capacity, participants, chat };
};

const PAST_SEED: Omit<PastRoom, "streams" | "cachedAgo">[] = [
  {
    id: "p1",
    name: "seven movie",
    streamer: "theater_mode",
    started: "53m",
    members: ["theater_mode", "kodama_jpg", "nebula.wav"],
  },
  {
    id: "p2",
    name: "test",
    streamer: "ferris.chan",
    started: "9m",
    members: ["ferris.chan", "conveyor.belt"],
  },
  {
    id: "p3",
    name: "test movie",
    streamer: "theater_mode",
    started: "1h",
    members: ["theater_mode", "milo.draws", "bitreverb"],
  },
  { id: "p4", name: "TEST", streamer: "pixel.rot", started: "38m", members: ["pixel.rot"] },
  {
    id: "p5",
    name: "Test Quality",
    streamer: "render_farm",
    started: "1h 3m",
    members: ["render_farm", "bitreverb"],
  },
  {
    id: "p6",
    name: "League with Pako",
    streamer: "lowpoly.lina",
    started: "1h 44m",
    members: ["lowpoly.lina", "kodama_jpg"],
  },
];

const PAST_STREAMS: Record<string, { ago: string; streams: Stream[] }> = {
  p1: { ago: "2h ago", streams: [{ user: "theater_mode", screen: "game" }] },
  p2: {
    ago: "3h ago",
    streams: [
      { user: "ferris.chan", screen: "cli" },
      { user: "conveyor.belt", screen: "browser" },
    ],
  },
  p3: {
    ago: "5h ago",
    streams: [
      { user: "theater_mode", screen: "game" },
      { user: "milo.draws", screen: "browser" },
      { user: "bitreverb", screen: "ableton" },
    ],
  },
  p4: { ago: "6h ago", streams: [{ user: "pixel.rot", screen: "browser" }] },
  p5: {
    ago: "8h ago",
    streams: [
      { user: "render_farm", screen: "browser" },
      { user: "bitreverb", screen: "fl-studio" },
    ],
  },
  p6: {
    ago: "1d ago",
    streams: [
      { user: "lowpoly.lina", screen: "game" },
      { user: "kodama_jpg", screen: "game" },
    ],
  },
};

export const PAST_ROOMS: PastRoom[] = PAST_SEED.map((r) => {
  const c = PAST_STREAMS[r.id];
  return {
    ...r,
    streams: c ? c.streams : [{ user: r.streamer, screen: "browser" }],
    cachedAgo: c ? c.ago : "earlier",
  };
});

const profile = (
  username: string,
  discord: string,
  joined: string,
  s: [number, number, number, number, number],
): UserProfile => ({
  // stable id, independent of the (renameable) Discord username — ADR 13 addendum
  id: `usr_${username.replace(/\W/g, "")}`,
  username,
  discord,
  joined,
  stats: {
    hoursStreamed: s[0],
    hoursWatched: s[1],
    roomsHosted: s[2],
    roomsJoined: s[3],
    peakViewers: s[4],
  },
});

export const USER_PROFILES: Record<string, UserProfile> = Object.fromEntries(
  [
    profile("nelly.jpg", "nelly", "March 2024", [42.3, 187.6, 12, 88, 9]),
    profile("kodama_jpg", "kodama", "Nov 2023", [214.8, 302.1, 48, 156, 9]),
    profile("bitreverb", "bitreverb", "Jan 2024", [163.2, 241.5, 31, 124, 9]),
    profile("ferris.chan", "ferris", "Aug 2023", [98.7, 412.3, 19, 203, 8]),
    profile("milo.draws", "milo", "Dec 2023", [76.4, 189.0, 22, 97, 7]),
    profile("nebula.wav", "nebula", "Feb 2024", [34.1, 156.7, 8, 112, 6]),
    profile("conveyor.belt", "conveyor", "Oct 2023", [121.9, 98.4, 27, 62, 9]),
    profile("render_farm", "render", "Sept 2023", [88.2, 134.8, 16, 78, 8]),
    profile("theater_mode", "theater", "Jul 2023", [302.5, 521.2, 64, 201, 9]),
    profile("sine.waver", "sine", "Jan 2024", [19.8, 87.5, 4, 56, 5]),
    profile("pixel.rot", "pixel", "Nov 2023", [45.6, 112.3, 11, 71, 6]),
    profile("lowpoly.lina", "lina", "Feb 2024", [67.3, 201.8, 14, 119, 7]),
  ].map((p) => [p.username, p]),
);

export const userIdOf = (username: string) => USER_PROFILES[username]?.id ?? username;
export const profileById = (id: string) => Object.values(USER_PROFILES).find((p) => p.id === id);

// user_cotime.seconds_together — symmetric, stored one-way.
const USER_COTIME: Record<string, number> = {
  "nelly.jpg:kodama_jpg": 48720,
  "nelly.jpg:bitreverb": 51300,
  "nelly.jpg:milo.draws": 39960,
  "nelly.jpg:nebula.wav": 28440,
  "nelly.jpg:ferris.chan": 22140,
  "nelly.jpg:theater_mode": 18600,
  "nelly.jpg:conveyor.belt": 14220,
  "nelly.jpg:render_farm": 9840,
  "nelly.jpg:lowpoly.lina": 7200,
  "nelly.jpg:pixel.rot": 4560,
  "nelly.jpg:sine.waver": 2400,
  "kodama_jpg:bitreverb": 92400,
  "kodama_jpg:milo.draws": 61200,
  "kodama_jpg:nebula.wav": 44400,
  "kodama_jpg:theater_mode": 38700,
  "kodama_jpg:ferris.chan": 27300,
  "kodama_jpg:conveyor.belt": 19800,
  "kodama_jpg:render_farm": 15600,
  "kodama_jpg:lowpoly.lina": 11400,
  "kodama_jpg:pixel.rot": 8400,
  "bitreverb:milo.draws": 54600,
  "bitreverb:nebula.wav": 49800,
  "bitreverb:theater_mode": 32400,
  "bitreverb:ferris.chan": 18000,
  "bitreverb:conveyor.belt": 12000,
  "bitreverb:render_farm": 22200,
  "ferris.chan:conveyor.belt": 71400,
  "ferris.chan:pixel.rot": 32400,
  "ferris.chan:render_farm": 19800,
  "ferris.chan:sine.waver": 14400,
  "ferris.chan:theater_mode": 8400,
  "milo.draws:nebula.wav": 38400,
  "milo.draws:lowpoly.lina": 42000,
  "milo.draws:pixel.rot": 26400,
  "milo.draws:render_farm": 31200,
  "milo.draws:theater_mode": 12600,
  "nebula.wav:theater_mode": 46800,
  "nebula.wav:lowpoly.lina": 18600,
  "nebula.wav:sine.waver": 9000,
  "theater_mode:lowpoly.lina": 29400,
  "theater_mode:render_farm": 22800,
  "conveyor.belt:pixel.rot": 24000,
  "conveyor.belt:sine.waver": 16200,
  "render_farm:pixel.rot": 15000,
  "render_farm:lowpoly.lina": 10800,
  "lowpoly.lina:pixel.rot": 6600,
  "sine.waver:pixel.rot": 3600,
};

const cotimeSeconds = (a: string, b: string) =>
  a === b ? 0 : (USER_COTIME[`${a}:${b}`] ?? USER_COTIME[`${b}:${a}`] ?? 0);

export const topCoUsers = (username: string, n = 5): CoUser[] =>
  Object.keys(USER_PROFILES)
    .filter((u) => u !== username)
    .map((u) => ({ username: u, seconds: cotimeSeconds(username, u) }))
    .filter((x) => x.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, n);

const dayLabel = (i: number) => {
  const d = new Date("2026-03-26");
  d.setDate(d.getDate() + i);
  return d.toISOString().slice(5, 10);
};

export const USER_GROWTH: UserGrowthPoint[] = (() => {
  const seed = [
    0, 1, 0, 2, 1, 0, 3, 1, 2, 1, 4, 2, 1, 3, 5, 2, 1, 3, 2, 4, 3, 2, 5, 3, 4, 2, 3, 5, 4, 3,
  ];
  let cumulative = 47;
  return seed.map((n, i) => {
    cumulative += n;
    return { date: dayLabel(i), new_users: n, cumulative };
  });
})();

export const ROOM_ACTIVITY: RoomActivityPoint[] = (() => {
  const created = [
    4, 6, 3, 7, 5, 8, 6, 9, 7, 5, 10, 8, 6, 11, 9, 7, 12, 8, 10, 9, 7, 13, 11, 9, 14, 10, 8, 12, 15,
    11,
  ];
  const ended = [
    3, 5, 4, 6, 5, 7, 5, 8, 6, 5, 9, 7, 6, 10, 8, 7, 11, 8, 9, 8, 7, 12, 10, 8, 13, 9, 8, 11, 14,
    10,
  ];
  return created.map((c, i) => ({ date: dayLabel(i), created: c, ended: ended[i] ?? 0 }));
})();

export const ALLTIME_ROOMS: AllTimeRoom[] = [
  ...LIVE_ROOMS.map(
    (r): AllTimeRoom => ({
      id: r.id,
      name: r.name,
      streamer: r.streamer,
      peak: r.viewers,
      joined: r.members.length,
      duration: r.started,
      status: "live",
      ended: null,
    }),
  ),
  ...PAST_ROOMS.map(
    (r): AllTimeRoom => ({
      id: r.id,
      name: r.name,
      streamer: r.streamer,
      peak: Math.max(2, r.members.length + 1),
      joined: r.members.length,
      duration: r.started,
      status: "ended",
      ended: "2h ago",
    }),
  ),
  ...(
    [
      ["h1", "friday game night", "kodama_jpg", 9, 10, "3h 22m", "1d ago"],
      ["h2", "synth wave deep dive", "bitreverb", 9, 10, "1h 48m", "1d ago"],
      ["h3", "rust async internals", "ferris.chan", 6, 8, "2h 12m", "2d ago"],
      ["h4", "cozy watch: spirited away", "theater_mode", 10, 10, "2h 5m", "2d ago"],
      ["h5", "procgen experiments", "render_farm", 5, 7, "1h 30m", "3d ago"],
      ["h6", "figma teardown: linear", "milo.draws", 8, 9, "1h 12m", "3d ago"],
      ["h7", "keyboard ergo chat", "lowpoly.lina", 4, 5, "42m", "4d ago"],
      ["h8", "factorio coop saturday", "conveyor.belt", 8, 10, "4h 3m", "5d ago"],
      ["h9", "nebula plays outer wilds", "nebula.wav", 7, 9, "2h 40m", "6d ago"],
      ["h10", "terminal dotfile party", "ferris.chan", 6, 7, "1h 20m", "7d ago"],
    ] as const
  ).map(
    ([id, name, streamer, peak, joined, duration, ended]): AllTimeRoom => ({
      id,
      name,
      streamer,
      peak,
      joined,
      duration,
      status: "ended",
      ended,
    }),
  ),
];
