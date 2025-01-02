import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { user } from "../lib/server/db/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined");
}
const db = drizzle(process.env.DATABASE_URL);

const users = db.select().from(user).execute();

console.log(users);
