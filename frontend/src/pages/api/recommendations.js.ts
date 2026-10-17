// src/pages/api/recommendations.js.ts
import { GET as handler } from "./recommendations";

export const prerender = false;

/**
 * Fallback handler to resolve 404s for old client-side caches attempting 
 * to fetch "/api/recommendations.js" instead of "/api/recommendations".
 */
export async function GET(context) {
    return handler(context);
}
