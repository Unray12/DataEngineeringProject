import { z } from "zod";

const optionalUrl = z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional());

export const env = z.object({
  DATA_MODE: z.enum(["mock", "api"]).default("mock"),
  API_BASE_URL: optionalUrl,
  API_KEY: z.string().optional(),
  APP_PASSWORD: z.string().optional(),
  NEXT_PUBLIC_APP_NAME: z.string().default("AgriMonitor"),
  NEXT_PUBLIC_TIMEZONE: z.string().default("Asia/Ho_Chi_Minh"),
}).parse({
  DATA_MODE: process.env.DATA_MODE,
  API_BASE_URL: process.env.API_BASE_URL,
  API_KEY: process.env.API_KEY,
  APP_PASSWORD: process.env.APP_PASSWORD,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_TIMEZONE: process.env.NEXT_PUBLIC_TIMEZONE,
});
