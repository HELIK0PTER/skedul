"use client";

import { useEffect, useRef, useState } from "react";

import { BrowserFrame, FRAME_W } from "./browser-frame";
import { DemoCursor } from "./demo-cursor";
import {
  DEMO_STEPS,
  stateAfter,
  stateEntering,
  type DemoAction,
  type DemoState,
} from "./demo-script";
import { DemoScreen } from "./screens";
import { Outro } from "./screens/outro";
import { TourControls } from "./tour-controls";

const TYPE_MS = 45;

export function DemoTour() {
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<DemoState>(() => stateEntering(0));
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState({ x: FRAME_W / 2, y: 260, visible: false, clickCount: 0 });

  const contentRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const indexRef = useRef(index);
  indexRef.current = index;

  function clearTimers() {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }

  function schedule(fn: () => void, delay: number) {
    timersRef.current.push(setTimeout(fn, delay));
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Coordonnées (en px de design, repère du cadre) du centre de la cible d'une action. */
  function locate(action: { target: string; find?: (f: HTMLElement) => HTMLElement | null }) {
    const frame = contentRef.current;
    if (!frame) return null;
    const el = action.find
      ? action.find(frame)
      : frame.querySelector<HTMLElement>(`[data-demo="${action.target}"]`);
    if (!el) return null;
    const frameRect = frame.getBoundingClientRect();
    const scale = frameRect.width / FRAME_W;
    const rect = el.getBoundingClientRect();
    return {
      x: (rect.left - frameRect.left + rect.width / 2) / scale,
      y: (rect.top - frameRect.top + rect.height / 2) / scale,
    };
  }

  function runTimeline(actions: DemoAction[], onDone: () => void) {
    const run = (i: number) => {
      if (i >= actions.length) {
        onDone();
        return;
      }
      const action = actions[i];
      switch (action.type) {
        case "wait":
          schedule(() => run(i + 1), action.delay);
          return;
        case "apply":
          setState((s) => ({ ...s, ...action.patch }));
          schedule(() => run(i + 1), action.delay ?? 350);
          return;
        case "move": {
          const pos = locate(action);
          if (pos) setCursor((c) => ({ ...c, ...pos, visible: true }));
          schedule(() => run(i + 1), action.delay ?? 750);
          return;
        }
        case "click": {
          const pos = locate(action);
          setCursor((c) => ({ ...c, ...(pos ?? {}), visible: true, clickCount: c.clickCount + 1 }));
          schedule(() => {
            if (action.patch) setState((s) => ({ ...s, ...action.patch }));
            schedule(() => run(i + 1), action.delay ?? 550);
          }, 180);
          return;
        }
        case "type": {
          const pos = locate(action);
          if (pos) setCursor((c) => ({ ...c, ...pos, visible: true }));
          const typeChar = (n: number) => {
            setState((s) => ({ ...s, [action.field]: action.text.slice(0, n) }));
            if (n < action.text.length) schedule(() => typeChar(n + 1), TYPE_MS);
            else schedule(() => run(i + 1), action.delay ?? 350);
          };
          schedule(() => typeChar(1), 400);
          return;
        }
      }
    };
    run(0);
  }

  function goTo(next: number) {
    if (next < 0 || next >= DEMO_STEPS.length) return;
    clearTimers();
    setIndex(next);
    if (prefersReducedMotion()) {
      setState(stateAfter(next));
      setCursor((c) => ({ ...c, visible: false }));
      if (playingRef.current && next < DEMO_STEPS.length - 1) {
        schedule(() => goTo(next + 1), 4000);
      }
      return;
    }
    setState(stateEntering(next));
    // Laisse le nouvel écran se monter avant de chercher les cibles.
    schedule(() => {
      runTimeline(DEMO_STEPS[next].timeline, () => {
        if (playingRef.current && next < DEMO_STEPS.length - 1) {
          schedule(() => goTo(next + 1), 1400);
        }
      });
    }, 350);
  }

  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  // Joue l'étape 1 au montage ; nettoie tout au démontage.
  useEffect(() => {
    goToRef.current(0);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ← / → au clavier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        goToRef.current(indexRef.current + 1);
      } else if (e.key === "ArrowLeft") {
        setPlaying(false);
        goToRef.current(indexRef.current - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Pause automatique quand l'onglet est masqué.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const step = DEMO_STEPS[index];
  const isOutro = step.chapter === "outro";

  return (
    // minmax(0,1fr) on phones too: an `auto` column would grow to the frame's
    // nowrap URL (different at each step), widening the page and the controls.
    <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] gap-6 px-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="mx-auto w-full max-w-[min(960px,calc((100dvh-240px)*960/840))]">
        {isOutro ? (
          <Outro
            onRestart={() => {
              setPlaying(false);
              goTo(0);
            }}
          />
        ) : (
          <BrowserFrame url={state.url} contentRef={contentRef}>
            <DemoScreen state={state} />
            <DemoCursor {...cursor} />
          </BrowserFrame>
        )}
      </div>
      <TourControls
        steps={DEMO_STEPS}
        index={index}
        playing={playing}
        onPrev={() => {
          setPlaying(false);
          goTo(index - 1);
        }}
        onNext={() => goTo(index + 1)}
        onJump={(i) => {
          setPlaying(false);
          goTo(i);
        }}
        onTogglePlay={() => {
          const next = !playing;
          setPlaying(next);
          if (next) goTo(index); // (re)joue l'étape courante puis enchaîne
        }}
      />
    </div>
  );
}
