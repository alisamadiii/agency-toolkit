// {{path.to.value}} substitution. No code execution: paths are plain property lookups.
// A string that is exactly one placeholder keeps the value's type (object, number...).

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_$.\-[\]]+)\s*\}\}/g;
const WHOLE = /^\{\{\s*([a-zA-Z0-9_$.\-[\]]+)\s*\}\}$/;

export type TemplateContext = Record<string, unknown>;

function lookup(ctx: TemplateContext, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: unknown = ctx;
  for (const part of parts) {
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function renderString(template: string, ctx: TemplateContext): unknown {
  const whole = template.match(WHOLE);
  if (whole) return lookup(ctx, whole[1]);
  return template.replace(PLACEHOLDER, (_, path: string) => stringify(lookup(ctx, path)));
}

export function render(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === 'string') return renderString(value, ctx);
  if (Array.isArray(value)) return value.map((v) => render(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, ctx)]));
  }
  return value;
}

export function renderText(template: string, ctx: TemplateContext): string {
  return stringify(renderString(template, ctx));
}
