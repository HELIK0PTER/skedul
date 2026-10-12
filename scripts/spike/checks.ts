import type { SpikeCheck } from "./db";
import { s1, s2, s3, s4, s5, s6, s7 } from "./batch-checks";
import { s8a, s8b, s8c, s8d, s8e } from "./auth-checks";

/** Every spike check, in run order. Tasks 3–6 append to it. */
export const CHECKS: SpikeCheck[] = [s1, s2, s3, s4, s5, s6, s7, s8a, s8b, s8c, s8d, s8e];
