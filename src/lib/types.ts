export enum MessageType {
  JOIN = "JOIN",
  CHATMESSAGE = "CHATMESSAGE",
  SETSTREAMER = "SETSTREAMER",
  LEAVE = "LEAVE",
}

export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  roomId: string | null;
}

export interface Room {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  streamer: User;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoomWithViewers extends Room {
  viewers: User[];
}

export interface ChatMessage {
  id: string;
  type: MessageType;
  content: string;
  user?: User;
  timestamp: Date;
}
