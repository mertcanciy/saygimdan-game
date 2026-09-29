import { Redis } from "@upstash/redis";

/**
 * Upstash Redis (Vercel Marketplace). Keys:
 *   user:{id}       hash   name, createdAt, via (password | google | mail), pw (scrypt), fb (Firebase uid)
 *   name:{lower}    string id  (claimed with SET NX)
 *   tok:{sha256}    string id  (device tokens; only the hash is stored)
 *   fb:{uid}        string id
 *   lb:{slug}       zset   id → game total
 *   lb:all          zset   id → overall total
 *   last:{id}:{slug} string last accepted score time (ms)
 *   fail:{lower}    string wrong passwords in the last 15 min
 */
let client: Redis | null = null;

export function db(): Redis {
  if (client) return client;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis is not configured (KV_REST_API_URL / KV_REST_API_TOKEN)");
  // plain strings back (a name like "1907" must not turn into a number)
  client = new Redis({ url, token, automaticDeserialization: false });
  return client;
}

export const k = {
  user: (id: string) => `user:${id}`,
  name: (lower: string) => `name:${lower}`,
  tok: (hash: string) => `tok:${hash}`,
  fb: (uid: string) => `fb:${uid}`,
  lb: (board: string) => `lb:${board}`,
  last: (id: string, slug: string) => `last:${id}:${slug}`,
  fail: (lower: string) => `fail:${lower}`,
};
