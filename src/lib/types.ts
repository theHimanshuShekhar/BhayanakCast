export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  joinedRoomId: string | null;
}

export interface Streamer extends User {
  streamUrl?: string;
}

export interface RoomBase {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  streamer: User | null;
}

export interface Room extends RoomBase {
  viewers: User[];
}
