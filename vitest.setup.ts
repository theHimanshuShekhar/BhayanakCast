import { config } from "dotenv";
import { resolve } from "node:path";

// Load test environment variables
config({ path: resolve(__dirname, ".env.test") });
