import { descobrirPorGenero } from "./src/services/tmdb.js";
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
    console.log("Testing descobrirPorGenero('28') [Action]...");
    const action = await descobrirPorGenero("28", 1, 2);
    console.log("Action items count:", action?.results?.length);
    if (action?.results?.length > 0) {
        console.log("First action item:", action.results[0].title || action.results[0].name);
        console.log("First item details:", JSON.stringify(action.results[0], null, 2));
    }
}

test();
