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
   - `PEER_HOST`: PeerJS server host
   - `PEER_PORT`: PeerJS server port
   - `SOCKET_PORT`: Socket.IO server port

4. Initialize the database:

   ```bash
   pnpm db push
   ```

5. Start the development servers:
   ```bash
   pnpm dev        # Start frontend + backend
   pnpm peer:serve # Start PeerJS server
   ```

Visit [http://localhost:3000](http://localhost:3000) to use the application.

## Development

- `pnpm dev` - Start development server
- `pnpm peer:serve` - Start PeerJS signaling server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run linter
- `pnpm test` - Run tests

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
