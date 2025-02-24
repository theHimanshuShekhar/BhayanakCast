# BhayanakCast 🎬

A cozy web application for hosting private watch parties with your friends. Stream videos and chat together in real-time using WebRTC and WebSocket technology.

## Features

- 🎥 Live video/audio streaming via PeerJS (WebRTC)
- 💬 Real-time room chat using Socket.IO
- 🔐 Private room creation and management
- 👥 Multiple viewer support
- 🎮 Low-latency peer-to-peer streaming
- 🎨 Modern UI with Tailwind CSS and shadcn/ui

## Tech Stack

### Frontend

- [TanStack](https://tanstack.com/) (Router + Query)
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- [PeerJS](https://peerjs.com/) for WebRTC streaming
- [Socket.IO Client](https://socket.io/docs/v4/client-api/) for real-time communication

### Backend

- [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL
- [Lucia](https://lucia-auth.com/) for authentication
- [Socket.IO](https://socket.io/) for WebSocket server
- [PeerJS Server](https://github.com/peers/peerjs-server) for WebRTC signaling

## Getting Started

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/BhayanakCast.git
   cd BhayanakCast
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Configure environment variables:

   ```bash
   cp .env.example .env
   ```

   Required variables:

   - `DATABASE_URL`: PostgreSQL connection string
   - `WEBSOCKETSERVER_URL`: WebSocket server URL (default: http://localhost:3333)
   - `WEBSOCKET_SERVER_PORT`: WebSocket server port
   - `PORT`: Application server port

   For Discord OAuth2 (optional):

   - `DISCORD_CLIENT_ID`: Discord application client ID
   - `DISCORD_CLIENT_SECRET`: Discord application secret
   - `DISCORD_REDIRECT_URI`: OAuth2 callback URL

4. Initialize the database:

   ```bash
   pnpm db push
   ```

5. Start the development servers:
   ```bash
   pnpm dev     # Start frontend development server
   pnpm server  # Start WebSocket server
   ```

Visit [http://localhost:3000](http://localhost:3000) to use the application.

## Development Commands

- `pnpm dev` - Start Vinxi development server
- `pnpm server` - Start WebSocket server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint
- `pnpm format` - Format code with Prettier
- `pnpm db` - Run Drizzle Kit commands
- `pnpm test` - Run Vitest tests
- `pnpm coverage` - Run tests with coverage report
- `pnpm ui` - Run shadcn/ui CLI

## Room Features

- Create private watch rooms
- Share room links with friends
- Stream video/audio to room participants
- Real-time chat with room members
- Video quality controls
- Room permissions management

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

[MIT License](LICENSE)
