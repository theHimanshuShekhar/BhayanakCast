import express, { type Express, type Request, type Response } from "express";
import { Server, type Socket } from "socket.io";
import { createServer } from "node:http";
import type { User } from "~/lib/server/db/schema";

const port = process.env.WEBSOCKET_SERVER_PORT || 8800;

const app: Express = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  /* options */
});

const connections: { [Name: string]: Socket } = {};
// const users: User[] = [];

io.on("connection", (socket: Socket) => {
  console.log("websocket connected! ", socket.id);

  connections[socket.id] = socket;
  console.log("Number of connections: ", Object.keys(connections).length);

  socket.on("disconnect", () => {
    console.log("websocket disconnected! ", socket.id);
    delete connections[socket.id];
    console.log("Number of connections: ", Object.keys(connections).length);
  });
});

app.get("/", (_req: Request, res: Response) => {
  console.log("received Request", io.httpServer.address());
  res.send(`<h1>BhayanakCast Websocket Server</h1>
  <h3>Please connect with a websocket client</h3>`);
});

httpServer.listen(port, () => console.log(`Websocket server running on port: ${port}`));
