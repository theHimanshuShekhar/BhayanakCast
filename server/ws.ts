import express, { type Express, type Request, type Response } from "express";
import { Server, type Socket } from "socket.io";
import { createServer } from "node:http";
import {
  addUserToRoomIfNotExists,
  fetchRoomDataFromID,
  removeUserFromAllRooms,
} from "~/lib/server/db/actions";
import { user, type User, type UserRoom } from "~/lib/server/db/schema";

type UserWithSocket = User & { socketId: string };

const port = process.env.WEBSOCKET_SERVER_PORT || 8800;

const app: Express = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  /* options */
  cors: {
    origin: "http://localhost:3000",
  },
});

const users: { [key: string]: UserWithSocket } = {};
const connections: { [key: string]: { socket: Socket; user_uuid: string } } = {};

io.on("connection", (socket: Socket) => {
  console.log("websocket connected! ", socket.id);

  let userUUID: string;

  console.log("Number of connections: ", io.engine.clientsCount);

  socket.on(
    "join_room",
    async (user_uuid: UserRoom["user_uuid"], room_uuid: UserRoom["room_uuid"]) => {
      await addUserToRoomIfNotExists(user_uuid, room_uuid);

      userUUID = user_uuid;

      const roomData = await fetchRoomDataFromID(room_uuid);
      socket.join(room_uuid);
      connections[socket.id] = { socket, user_uuid: user_uuid };

      console.log(roomData);
      io.to(room_uuid).emit("room_update", roomData);
    },
  );

  socket.on("user_connected", (user: User) => {
    users[user.uuid] = {
      ...user,
      socketId: socket.id,
    };

    console.log("user_connected", users[user.uuid].name);
  });

  socket.on("leave_room", (user_uuid) => {
    console.log("leave_room", user_uuid);
    removeUserFromAllRooms(user_uuid);
  });

  socket.on("disconnecting", () => {
    removeUserFromAllRooms(userUUID);
  });

  socket.on("disconnect", () => {
    console.log("websocket disconnected! ", socket.id);
    console.log("Number of connections: ", io.engine.clientsCount);

    delete connections[socket.id];
  });
});

app.get("/", (_req: Request, res: Response) => {
  console.log("received Request", io.httpServer.address());
  res.send(`<h1>BhayanakCast Websocket Server</h1>
  <h3>Please connect with a websocket client</h3>`);
});

httpServer.listen(port, () => console.log(`Websocket server running on port: ${port}`));
