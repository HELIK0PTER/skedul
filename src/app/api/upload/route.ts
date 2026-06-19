import { put } from "@vercel/blob";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getCurrentProfessional } from "@/lib/session";

const MAX: Record<"banner" | "avatar", number> = {
  banner: 5_000_000,
  avatar: 2_000_000,
};
const TYPES = ["image/jpeg", "image/png", "image/webp"];

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
  if (!TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Format non supporté (jpeg, png, webp)" },
      { status: 415 },
    );
  }
  if (file.size > MAX[kind]) {
    return NextResponse.json({ error: "Fichier trop volumineux" }, { status: 413 });
  }

  const ext = file.type.split("/")[1];
  const blob = await put(`branding/${pro.id}/${kind}-${nanoid()}.${ext}`, file, {
    access: "public",
    token: env.BLOB_READ_WRITE_TOKEN,
  });
  return NextResponse.json({ url: blob.url });
}
