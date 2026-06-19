/**
 * Curated 3D character avatars bundled under `public/avatars/3d/`.
 * Source: Microsoft Fluent Emoji (MIT). Fetched via `scripts/fetch-avatar-pack.ts`.
 * `id` is the local filename (without extension).
 */
export interface PackAvatar {
  id: string;
  alt: string;
}

export const AVATAR_PACK: PackAvatar[] = [
  { id: "artist", alt: "Artiste" },
  { id: "astronaut", alt: "Astronaute" },
  { id: "cook", alt: "Cuisinier" },
  { id: "detective", alt: "Détective" },
  { id: "factory-worker", alt: "Ouvrier" },
  { id: "farmer", alt: "Agriculteur" },
  { id: "firefighter", alt: "Pompier" },
  { id: "guard", alt: "Agent" },
  { id: "health-worker", alt: "Soignant" },
  { id: "judge", alt: "Juge" },
  { id: "mechanic", alt: "Mécanicien" },
  { id: "ninja", alt: "Ninja" },
  { id: "office-worker", alt: "Employé de bureau" },
  { id: "pilot", alt: "Pilote" },
  { id: "scientist", alt: "Scientifique" },
  { id: "singer", alt: "Chanteur" },
  { id: "student", alt: "Étudiant" },
  { id: "teacher", alt: "Enseignant" },
  { id: "technologist", alt: "Technicien" },
  { id: "police-officer", alt: "Policier" },
  { id: "construction-worker", alt: "Ouvrier BTP" },
  { id: "prince", alt: "Prince" },
  { id: "princess", alt: "Princesse" },
  { id: "person-juggling", alt: "Jongleur" },
];

export function packSrc(id: string): string {
  return `/avatars/3d/${id}.png`;
}
