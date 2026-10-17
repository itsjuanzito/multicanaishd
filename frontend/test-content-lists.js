import { getContentList } from "./src/services/content-lists.js";
import fs from 'fs';

// Load .env.local manually
if (fs.existsSync('.env.local')) {
    const content = fs.readFileSync('.env.local', 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const match = trimmed.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                let val = match[2].trim();
                // strip quotes
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                process.env[key] = val;
            }
        }
    }
}

async function test() {
    console.log("Testing getContentList('animes')...");
    const animes = await getContentList('animes');
    console.log("Animes found:", animes.results?.length);
    if (animes.results?.length > 0) {
        console.log("First anime:", animes.results[0].title);
        console.log("First anime details:", JSON.stringify(animes.results[0], null, 2));
    }

    console.log("\nTesting getContentList('doramas')...");
    const doramas = await getContentList('doramas');
    console.log("Doramas found:", doramas.results?.length);
    if (doramas.results?.length > 0) {
        console.log("First dorama:", doramas.results[0].title);
        console.log("First dorama details:", JSON.stringify(doramas.results[0], null, 2));
    }
}

test();
