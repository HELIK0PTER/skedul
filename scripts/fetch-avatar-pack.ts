/**
 * Downloads the bundled 3D avatar pack from Microsoft Fluent Emoji (MIT)
 * into `public/avatars/3d/`. Person emojis live under `<Name>/Default/3D/`,
 * object/character emojis under `<Name>/3D/`; we try both. Run with:
 *   pnpm tsx scripts/fetch-avatar-pack.ts
 */
import { mkdir, writeFile } from "node:fs/promises";

import { AVATAR_PACK } from "../src/lib/avatar-pack";

const BASE = "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets";

// local id -> Fluent Emoji folder name
const FOLDER: Record<string, string> = {
  artist: "Artist",
  astronaut: "Astronaut",
  cook: "Cook",
  detective: "Detective",
  "factory-worker": "Factory worker",
  farmer: "Farmer",
  firefighter: "Firefighter",
  guard: "Guard",
  "health-worker": "Health worker",
  judge: "Judge",
  mechanic: "Mechanic",
  ninja: "Ninja",
  "office-worker": "Office worker",
  pilot: "Pilot",
  scientist: "Scientist",
  singer: "Singer",
  student: "Student",
  teacher: "Teacher",
  technologist: "Technologist",
  "police-officer": "Police officer",
  "construction-worker": "Construction worker",
  prince: "Prince",
  princess: "Princess",
  "person-juggling": "Person juggling",
};

const OUT = "public/avatars/3d";

function candidates(folder: string): string[] {
  const snake = folder.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return [
    `${BASE}/${encodeURIComponent(folder)}/Default/3D/${snake}_3d_default.png`,
    `${BASE}/${encodeURIComponent(folder)}/3D/${snake}_3d.png`,
  ];
}

async function main() {
  await mkdir(OUT, { recursive: true });
  let ok = 0;
  const missing: string[] = [];

  for (const { id } of AVATAR_PACK) {
    const folder = FOLDER[id];
    if (!folder) {
      missing.push(`${id} (pas de mapping FOLDER)`);
      continue;
    }
    let saved = false;
    for (const url of candidates(folder)) {
      const res = await fetch(url);
      if (!res.ok) continue;
      await writeFile(`${OUT}/${id}.png`, Buffer.from(await res.arrayBuffer()));
      ok++;
      saved = true;
      break;
    }
    if (!saved) missing.push(`${id} (${folder})`);
  }

  console.log(`✅ ${ok}/${AVATAR_PACK.length} avatars téléchargés dans ${OUT}`);
  if (missing.length) {
    console.warn(`⚠️  manquants (à corriger ou retirer du manifeste):`);
    for (const m of missing) console.warn(`   - ${m}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
