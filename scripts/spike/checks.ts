import type { SpikeCheck } from "./db";
import { s1, s4, s7 } from "./batch-checks";

/** Every spike check, in run order. Tasks 3–6 append to it. */
export const CHECKS: SpikeCheck[] = [s1, s4, s7];
