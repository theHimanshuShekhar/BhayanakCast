import express, { type Express, type Request, type Response } from "express";
import { Server, type Socket } from "socket.io";
import { createServer } from "node:http";
import type { Room, User, UserRoom } from "~/lib/server/db/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

type UserWithSocketAndRoom = User & { socketId: string; room_uuid: string };

const apiURL = "http://localhost:3000";

const port = process.env.WEBSOCKET_SERVER_PORT || 8800;

const app: Express = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  /* options */
  cors: {
    origin: "http://localhost:3000",
  },
});

interface Dictionary<T> {
  [key: string]: T;
}

const users: Dictionary<UserWithSocketAndRoom> = {};
const connections: Dictionary<Socket> = {};

io.on("connection", (socket: Socket) => {
  console.log("websocket connected! ", socket.id);
  connections[socket.id] = socket;

  console.log("Number of connections: ", io.engine.clientsCount);

  socket.on("user_connected", (user: User, room_uuid: string) => {
    users[user.uuid] = {
      ...user,
      socketId: socket.id,
      room_uuid: room_uuid,
    };

    console.log(`${new Date().toTimeString()} user_connected`, users[user.uuid].name);
  });

  socket.on(
    "join_room",
    async (user_uuid: UserRoom["user_uuid"], room_uuid: UserRoom["room_uuid"]) => {
      const user = Object.values(users).find((user) => user.socketId === socket.id);
      if (!user) return;
      await fetch(`${apiURL}/api/db/addUserToRoom/${user.uuid}/${user.room_uuid}`)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
          return response.json();
        })
        .then((newRelation) => {
          if (newRelation) {
            console.log(`User: ${user.name} joined Room:${room_uuid}`);
            socket.join(room_uuid);
            updateRoomData(room_uuid);
          }
        });
    },
  );

  socket.on("disconnect", async () => {
    console.log("websocket disconnected! ", socket.id);
    console.log("Number of connections: ", io.engine.clientsCount);
    const user = Object.values(users).find((user) => user.socketId === socket.id);
    if (!user) return;
    await fetch(
      `${apiURL}/api/db/removeUserFromRoom//${user.uuid}/${user.room_uuid}`,
    ).then((response) => {
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      console.log(`User: ${user.name} left Room:${user.room_uuid}`);
      updateRoomData(user.room_uuid);
      delete users[user.uuid];
      delete connections[socket.id];
    });
  });
});

const updateRoomData = async (room_uuid: string) => {
  fetch(`${apiURL}/api/db/getRoomFromID/${room_uuid}`)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      return response.json();
    })
    .then((roomData: Room) => {
      console.log(`Updating room: ${roomData.name} : ${roomData.uuid}`);
      io.to(room_uuid).emit("room_update", roomData);
    });
};

app.get("/", (_req: Request, res: Response) => {
  console.log("received Request", io.httpServer.address());
  res.send(`<h1>BhayanakCast Websocket Server</h1>
  <h3>Please connect with a websocket client</h3>`);
});

httpServer.listen(port, () => console.log(`Websocket server running on port: ${port}`));
