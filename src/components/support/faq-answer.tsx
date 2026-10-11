import Link from "next/link";

import { parseAnswer, type AnswerSegment } from "@/lib/support";
import { cn } from "@/lib/utils";

const LINK =
  "font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary";

function Segments({ segments }: { segments: AnswerSegment[] }) {
  return segments.map((s, i) =>
    s.kind === "text" ? (
      <span key={i}>{s.text}</span>
    ) : s.href.startsWith("/") ? (
      <Link key={i} href={s.href} className={LINK}>
        {s.text}
      </Link>
    ) : (
      <a key={i} href={s.href} target="_blank" rel="noreferrer" className={LINK}>
        {s.text}
      </a>
    ),
  );
}

/** A FAQ answer: plain text parsed into paragraphs, lists and links, never raw HTML. */
export function FaqAnswer({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("space-y-3 text-[0.9375rem] leading-relaxed text-muted-foreground", className)}>
      {parseAnswer(text).map((block, i) =>
        block.kind === "paragraph" ? (
          <p key={i} className="max-w-[65ch]">
            <Segments segments={block.segments} />
          </p>
        ) : (
          <ul key={i} className="max-w-[65ch] list-disc space-y-1 pl-5 marker:text-primary">
            {block.items.map((item, j) => (
              <li key={j}>
                <Segments segments={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
