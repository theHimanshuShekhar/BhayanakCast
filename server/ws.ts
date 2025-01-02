import express, { type Express, type Request, type Response } from "express";
import { Server, type Socket } from "socket.io";
import { createServer } from "node:http";
import { addUserToRoomIfNotExists } from "~/lib/server/db/actions";
import type { User, UserRoom } from "~/lib/server/db/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

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

interface Dictionary<T> {
  [key: string]: T;
}

const users: Dictionary<UserWithSocket> = {};
const connections: Dictionary<Socket> = {};

io.on("connection", (socket: Socket) => {
  console.log("websocket connected! ", socket.id);

  console.log("Number of connections: ", io.engine.clientsCount);

  socket.on("user_connected", (user: User) => {
    users[user.uuid] = {
      ...user,
      socketId: socket.id,
    };

    console.log(`${new Date().toTimeString()} user_connected`, users[user.uuid].name);
  });

  socket.on("user_disconnected", (user: User) => {
    if (!users[user.uuid]) return;
    console.log(`${new Date().toTimeString()} user_disconnected`, users[user.uuid].name);
    delete users[user.uuid];
  });

  socket.on(
    "join_room",
    async (user_uuid: UserRoom["user_uuid"], room_uuid: UserRoom["room_uuid"]) => {
      await addUserToRoomIfNotExists(user_uuid, room_uuid);

      socket.join(room_uuid);
      connections[user_uuid] = socket;

      console.log("Connections: ", Object.keys(connections));

      // updateRoomData(room_uuid);
    },
  );

  // socket.on("leave_room", async (socketID, roomID) => {
  //   console.log("leave_room", connections[socketID].user_uuid);

  //   // // Need to remove user from rooms
  //   // await removeUserFromRoom(connections[socketID].user_uuid, roomID);
  //   // updateRoomData(roomID);
  // });

  // socket.on("disconnecting", async () => {});

  socket.on("disconnect", () => {
    console.log("websocket disconnected! ", socket.id);
    console.log("Number of connections: ", io.engine.clientsCount);

    // Need to remove user from rooms
    console.log("Connections: ", Object.keys(connections));
    // console.log("delete connection user", connections[socketID].user_uuid);
    // removeUserFromAllRooms(connections[socket.id].user_uuid);

    delete connections[socket.id];
  });
});

// const updateRoomData = async (room_uuid: string) => {
//   console.log(`Updating room: ${room_uuid}`);
//   await fetchRoomDataFromID(room_uuid).then((roomData) =>
//     io.to(room_uuid).emit("room_update", roomData),
//   );
// };

app.get("/", (_req: Request, res: Response) => {
  console.log("received Request", io.httpServer.address());
  res.send(`<h1>BhayanakCast Websocket Server</h1>
  <h3>Please connect with a websocket client</h3>`);
});

httpServer.listen(port, () => console.log(`Websocket server running on port: ${port}`));
