import { put } from "@vercel/blob";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";

import { BRANDING_MAX_BYTES, BRANDING_TYPES, brandingBlobPath } from "@/lib/branding-upload";
import { env } from "@/lib/env";
import { getCurrentProfessional } from "@/lib/session";

const isBrandingType = (type: string): type is keyof typeof BRANDING_TYPES => Object.hasOwn(BRANDING_TYPES, type);

export async function POST(req: Request) {
  if (!env.BLOB_ENABLED) {
    return NextResponse.json({ error: "Stockage non configuré" }, { status: 503 });
  }
  const pro = await getCurrentProfessional();
  if (!pro) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const kind = form.get("kind") === "banner" ? "banner" : "avatar";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  }
  if (!isBrandingType(file.type)) {
    return NextResponse.json(
      { error: "Format non supporté (jpeg, png, webp)" },
      { status: 415 },
    );
  }
  if (file.size > BRANDING_MAX_BYTES[kind]) {
    const mb = BRANDING_MAX_BYTES[kind] / 1_000_000;
    return NextResponse.json(
      { error: `Image trop lourde (${mb} Mo maximum).` },
      { status: 413 },
    );
  }

  // The path the branding action accepts back (isOwnBrandingUpload): the pro's folder, the kind, a jpeg, png or webp.
  const blob = await put(brandingBlobPath(pro.id, kind, nanoid(), BRANDING_TYPES[file.type]), file, {
    access: "public",
    token: env.BLOB_READ_WRITE_TOKEN,
  });
  return NextResponse.json({ url: blob.url });
}
