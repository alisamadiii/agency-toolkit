import type { z } from 'zod';

import type { conditionSchema, ifConfigSchema } from '@/lib/schemas';
import { renderString, type TemplateContext } from '@/lib/template';

type Condition = z.output<typeof conditionSchema>;

function asNumber(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asText(value: unknown) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function isEmpty(value: unknown) {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

export function evaluateCondition(c: Condition, ctx: TemplateContext): boolean {
  const left = renderString(c.left, ctx);
  const right = renderString(c.right, ctx);
  switch (c.op) {
    case 'equals': {
      const [a, b] = [asNumber(left), asNumber(right)];
      return a !== null && b !== null ? a === b : asText(left) === asText(right);
    }
    case 'notEquals': {
      const [a, b] = [asNumber(left), asNumber(right)];
      return a !== null && b !== null ? a !== b : asText(left) !== asText(right);
    }
    case 'contains':
      return Array.isArray(left) ? left.some((v) => asText(v) === asText(right)) : asText(left).includes(asText(right));
    case 'gt': {
      const [a, b] = [asNumber(left), asNumber(right)];
      return a !== null && b !== null && a > b;
    }
    case 'lt': {
      const [a, b] = [asNumber(left), asNumber(right)];
      return a !== null && b !== null && a < b;
    }
    case 'isEmpty':
      return isEmpty(left);
    case 'isNotEmpty':
      return !isEmpty(left);
    case 'isTrue':
      return left === true || asText(left).toLowerCase() === 'true';
  }
}

export function evaluateIf(config: z.output<typeof ifConfigSchema>, ctx: TemplateContext) {
  const results = config.conditions.map((c) => evaluateCondition(c, ctx));
  return config.combine === 'and' ? results.every(Boolean) : results.some(Boolean);
}
