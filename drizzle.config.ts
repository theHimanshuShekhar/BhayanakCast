import type { Config } from "drizzle-kit";

export default {
  out: "./.drizzle",
  schema: "./lib/server/db/schema.ts",
  breakpoints: true,
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL as string,
  },
  verbose: true,
  strict: true,
} satisfies Config;
