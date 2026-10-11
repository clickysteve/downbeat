/**
 * EXTENDED conditional triggers: WHEN <condition> THEN <action>.
 *
 * Safety: rules are evaluated exactly once per cycle, when the cycle is
 * planned, from the state at the cycle's start. Actions never trigger rule
 * evaluation, so there is no recursion; at most MAX_RULES rules fire per
 * cycle and every effect has a finite duration in cycles. Conditions use the
 * seeded hash, so a take replays identically.
 */
import { SALT, rand, strCode } from '../engine/rng';
import { MAX_RULES, type Rule, type RuleAction, type RuleWhen, type Voice } from '../engine/types';

export interface RuleContext {
  cycle: number;
  rep: number;
  patternStart: boolean;
  generation: number;
  generationChanged: boolean;
  /** Previous cycle: written and played source strikes per voice. */
  prev: Record<string, { written: number; played: number }> | null;
  seed: number;
}

export function conditionMet(w: RuleWhen, ctx: RuleContext, ruleId: string): boolean {
  switch (w.type) {
    case 'every': {
      const n = Math.max(1, Math.floor(w.n));
      const off = ((Math.floor(w.offset) % n) + n) % n;
      return ctx.cycle % n === off;
    }
    case 'rep':
      return ctx.rep === Math.max(1, Math.floor(w.n)) - 1;
    case 'patternStart':
      return ctx.patternStart;
    case 'density': {
      const s = ctx.prev?.[w.voice];
      if (!s || s.written === 0) return false;
      return (s.played / s.written) * 100 < w.below;
    }
    case 'generation':
      return ctx.generationChanged && ctx.generation > 0 && ctx.generation % Math.max(1, Math.floor(w.every)) === 0;
    case 'chance':
      return rand(ctx.seed, SALT.rule, strCode(ruleId), ctx.cycle) < w.p / 100;
  }
}

export function resolveTarget(target: string, voices: Voice[]): string[] {
  if (target === 'all' || !target) return voices.map((v) => v.id);
  if (target.startsWith('@')) {
    const fam = target.slice(1);
    return voices.filter((v) => v.family === fam || (fam === 'hat' && v.family === 'openhat')).map((v) => v.id);
  }
  return voices.some((v) => v.id === target) ? [target] : [];
}

export interface Fired {
  rule: Rule;
  action: RuleAction;
  voices: string[];
}

export function evaluateRules(rules: Rule[], ctx: RuleContext, voices: Voice[]): Fired[] {
  const out: Fired[] = [];
  for (const r of rules.slice(0, MAX_RULES)) {
    if (!r.on) continue;
    if (!conditionMet(r.when, ctx, r.id)) continue;
    out.push({ rule: r, action: r.then, voices: resolveTarget(r.target, voices) });
  }
  return out;
}

export const ACTION_LABEL: Record<RuleAction, string> = {
  fill: 'FILL',
  mutate: 'MUTATE',
  thin: 'THIN',
  boost: 'BOOST',
  mute: 'MUTE',
  unmute: 'UNMUTE',
  reset: 'RETURN TO SOURCE',
  source: 'PLAY SOURCE',
  next: 'NEXT PATTERN',
};

export function describeWhen(w: RuleWhen, voices: Voice[]): string {
  switch (w.type) {
    case 'every':
      return w.offset ? `EVERY ${w.n} CYCLES (+${w.offset})` : `EVERY ${w.n} CYCLES`;
    case 'rep':
      return `REPEAT ${w.n} OF PATTERN`;
    case 'patternStart':
      return 'PATTERN STARTS';
    case 'density':
      return `${voices.find((v) => v.id === w.voice)?.name ?? '?'} PLAYS < ${w.below}%`;
    case 'generation':
      return `EVERY ${w.every} GENERATIONS`;
    case 'chance':
      return `CHANCE ${w.p}%`;
  }
}
