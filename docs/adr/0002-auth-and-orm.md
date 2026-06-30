# Better Auth and Drizzle

BhayanakCast will use Better Auth for application authentication and Drizzle ORM for database access. Better Auth has a Discord social provider and a Drizzle adapter; Drizzle provides TypeScript schema declarations and migration generation for PostgreSQL, which fits the public-account, moderation, and room-history data model without introducing a heavier ORM.

Better Auth is the authentication boundary; Discord is the only v1 sign-in provider. Drizzle is the persistence boundary for product data and Better Auth tables.

Platform admins are identified by a static allowlist of Discord user IDs in configuration, not by mutable database roles or Discord guild-role synchronization.

Private-room passwords are stored as hashes only; hosts cannot recover the existing password from the system.

The app container runs Drizzle migrations on startup and must fail startup rather than serve against a schema it cannot migrate.
