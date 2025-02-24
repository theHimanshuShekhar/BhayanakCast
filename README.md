# [TanStarter](https://github.com/dotnize/tanstarter)

A minimal starter template for 🏝️ TanStack Start.

- TanStack [Start](https://tanstack.com/start/latest) + [Router](https://tanstack.com/router/latest) + [Query](https://tanstack.com/query/latest)
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL
- Auth based on [Lucia](https://lucia-auth.com/)

Auth providers:

- [x] GitHub
- [x] Google
- [x] Discord

## Getting Started

1. [Use this template](https://github.com/new?template_name=tanstarter&template_owner=dotnize) or clone this repository.

2. Install dependencies:

   ```bash
   pnpm install # npm install
   ```

3. Create a `.env` file based on [`.env.example`](./.env.example).

4. Push the schema to your database with drizzle-kit:

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

5. Initialize the database:

   ```bash
   pnpm dev # npm run dev
   ```

   The development server should be now running at [http://localhost:3000](http://localhost:3000).

## Building for production

1. Configure [`app.config.ts`](./app.config.ts#L15) for your preferred deployment target. Read the [hosting](https://tanstack.com/router/latest/docs/framework/react/start/hosting#deployment) docs for more information.

2. Build the application:

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
