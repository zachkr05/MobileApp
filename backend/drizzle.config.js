import { ENV } from "./src/config/env.js";
import { defineConfig } from 'drizzle-kit';
import 'dotenv/config'; // <-- Add this line at the top

export default {
schema: "./src/db/schema.js",
out: "./src/db/migrations",
dialect: "postgresql",
dbCredentials: { url: ENV.DATABASE_URL},
};