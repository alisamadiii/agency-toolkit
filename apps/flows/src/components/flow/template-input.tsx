'use client';

import { Braces } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { checkTemplate, filterVariables, hasTriggerFields, type TemplateScope, type Variable } from './variables';

// {{ autocomplete for template fields. Typing "{{" (or clicking the { } button) opens a
// list of what this node can reference; picking one inserts {{path}} at the caret.

export type TemplateField = HTMLInputElement | HTMLTextAreaElement;

type VariablesContextValue = {
  variables: Variable[];
  // Saves the trigger's sample input (inline "Add trigger fields"); absent when read-only.
  onSaveSample?: (sample: Record<string, unknown>) => void;
  sampleDraft?: string;
  // Remembers the last focused template field, so a Variables chip can insert into it.
  onFieldFocus?: (el: TemplateField) => void;
  // Which node is being edited and what's on the canvas, to explain bad references.
  scope?: TemplateScope;
};

export const VariablesContext = createContext<VariablesContextValue>({ variables: [] });

export const useVariables = () => useContext(VariablesContext);

// Same characters lib/template.ts accepts in a path.
const OPEN_RE = /\{\{\s*([\w.[\]$-]*)$/;

// Replaces text[start, end) with {{path}} and drops a "}}" that already follows.
function spliceVariable(text: string, start: number, end: number, path: string) {
  const insert = `{{${path}}}`;
  const rest = text.slice(end).replace(/^[\w.[\]$-]*\s*\}\}/, '');
  return { value: text.slice(0, start) + insert + rest, caret: start + insert.length };
}

// Sets a controlled field's value the way typing would, so React's onChange fires.
function setNativeValue(el: TemplateField, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function replaceRange(el: TemplateField, start: number, end: number, path: string) {
  const next = spliceVariable(el.value, start, end, path);
  setNativeValue(el, next.value);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(next.caret, next.caret);
  });
}

// Inserts {{path}} at the caret (or over the selection).
export function insertVariable(el: TemplateField, path: string) {
  const start = el.selectionStart ?? el.value.length;
  replaceRange(el, start, el.selectionEnd ?? start, path);
}

type OpenState = { start: number; end: number; query: string };

type FieldProps = { multiline: true; rows?: number } | { multiline?: false };

type TemplateProps = Omit<React.ComponentProps<'input'> & React.ComponentProps<'textarea'>, 'ref'> & FieldProps;

function TemplateBox({ multiline, className, onChange, onKeyDown, onFocus, ...props }: TemplateProps) {
  const ctx = useVariables();
  const ref = useRef<TemplateField>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const anchorRect = useCallback(() => boxRef.current?.getBoundingClientRect(), []);
  const setMenuEl = useCallback((el: HTMLDivElement | null) => {
    menuRef.current = el;
  }, []);
  const [open, setOpen] = useState<OpenState | null>(null);
  const [active, setActive] = useState(0);
  // When nothing matches (e.g. a path to a step that doesn't run first), fall back to
  // matches on the last part of the path, then to everything, so there is always a choice.
  const { items, missed } = useMemo(() => {
    if (!open) return { items: [], missed: false };
    const exact = filterVariables(ctx.variables, open.query);
    if (exact.length || !open.query) return { items: exact, missed: false };
    const leaf = open.query.split(/[.[\]]/).filter(Boolean).pop() ?? '';
    const near = leaf ? filterVariables(ctx.variables, leaf) : [];
    return { items: near.length ? near : ctx.variables, missed: true };
  }, [ctx.variables, open]);
  const problems = useMemo(
    () => (typeof props.value === 'string' && props.value.includes('{{') ? checkTemplate(props.value, ctx.variables, ctx.scope ?? {}) : []),
    [props.value, ctx.variables, ctx.scope]
  );

  // Opens the menu while the caret sits right after "{{partial".
  const sync = () => {
    const el = ref.current;
    if (!el || el.selectionStart !== el.selectionEnd) return setOpen(null);
    const caret = el.selectionStart ?? 0;
    const m = el.value.slice(0, caret).match(OPEN_RE);
    if (!m) return setOpen(null);
    setOpen((prev) => {
      if (prev?.query !== m[1]) setActive(0);
      return { start: caret - m[0].length, end: caret, query: m[1] };
    });
  };

  const browse = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    setActive(0);
    setOpen({ start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length, query: '' });
  };

  const pick = (v: Variable) => {
    if (!ref.current || !open) return;
    replaceRange(ref.current, open.start, open.end, v.path);
    setOpen(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<TemplateField>) => {
    // Let IME composition (e.g. Japanese input) finish before Enter means "insert".
    if (open && !e.nativeEvent.isComposing) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return setOpen(null);
      }
      if (items.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        return setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
      }
      if (items.length && (e.key === 'Enter' || e.key === 'Tab')) {
        e.preventDefault();
        return pick(items[Math.min(active, items.length - 1)]);
      }
    }
    onKeyDown?.(e as never);
  };

  const shared = {
    ...props,
    autoComplete: 'off',
    className: cn('pr-9', className),
    onChange: (e: React.ChangeEvent<TemplateField>) => {
      onChange?.(e as never);
      sync();
    },
    onKeyDown: handleKeyDown,
    onKeyUp: (e: React.KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) sync();
    },
    onClick: sync,
    onFocus: (e: React.FocusEvent<TemplateField>) => {
      ctx.onFieldFocus?.(e.currentTarget);
      onFocus?.(e as never);
    },
  };

  return (
    <div
      ref={boxRef}
      className="relative"
      onBlur={(e) => {
        // The menu is portaled, so check it as well as the field.
        const next = e.relatedTarget as Node | null;
        if (!e.currentTarget.contains(next) && !menuRef.current?.contains(next)) setOpen(null);
      }}
    >
      {multiline ? (
        <Textarea {...(shared as React.ComponentProps<'textarea'>)} ref={ref as React.Ref<HTMLTextAreaElement>} />
      ) : (
        <Input {...(shared as React.ComponentProps<'input'>)} ref={ref as React.Ref<HTMLInputElement>} />
      )}
      <button
        type="button"
        tabIndex={-1}
        title="Insert a variable"
        aria-label="Insert a variable"
        disabled={props.disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={browse}
        className={cn(
          'absolute right-1.5 flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-ink disabled:pointer-events-none',
          multiline ? 'top-1.5' : 'top-1/2 -translate-y-1/2'
        )}
      >
        <Braces className="size-3.5" />
      </button>
      {problems.length > 0 && !open && (
        <div className="mt-1 grid gap-0.5">
          {problems.map((p) => (
            <p key={p} className="text-xs text-amber-700">
              {p}
            </p>
          ))}
        </div>
      )}
      {open && (
        <VariableMenu
          anchorRect={anchorRect}
          setMenuEl={setMenuEl}
          items={items}
          query={open.query}
          missed={missed}
          problem={problems.find((p) => p.includes(`{{${open.query}`))}
          active={active}
          onHover={setActive}
          onPick={pick}
          onSampleSaved={() => ref.current?.focus()}
        />
      )}
    </div>
  );
}

function VariableMenu({
  anchorRect,
  setMenuEl,
  items,
  query,
  missed,
  problem,
  active,
  onHover,
  onPick,
  onSampleSaved,
}: {
  anchorRect: () => DOMRect | undefined;
  setMenuEl: (el: HTMLDivElement | null) => void;
  items: Variable[];
  query: string;
  missed: boolean;
  problem?: string;
  active: number;
  onHover: (i: number) => void;
  onPick: (v: Variable) => void;
  onSampleSaved: () => void;
}) {
  const { variables } = useVariables();
  const listRef = useRef<HTMLDivElement>(null);

  const [pos, setPos] = useState<React.CSSProperties>({ visibility: 'hidden' });

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Fixed to the viewport under the field (or above it when there's no room below), so
  // no scrolling panel, dialog or canvas edge can clip it. Follows scroll and resize.
  useLayoutEffect(() => {
    const place = () => {
      const box = anchorRect();
      if (!box) return;
      const gap = 4;
      const below = window.innerHeight - box.bottom - gap - 8;
      const above = box.top - gap - 8;
      const up = below < 240 && above > below;
      setPos({
        position: 'fixed',
        left: box.left,
        width: box.width,
        maxHeight: Math.max(160, Math.min(420, up ? above : below)),
        ...(up ? { bottom: window.innerHeight - box.top + gap } : { top: box.bottom + gap }),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchorRect]);

  return createPortal(
    <div
      ref={setMenuEl}
      style={pos}
      className="z-[100] flex flex-col overflow-hidden rounded-lg border border-line bg-surface text-left shadow-lg"
      onMouseDown={(e) => {
        // Keep focus in the field, except inside the sample form.
        if (!(e.target as HTMLElement).closest('textarea, [data-keep-focus]')) e.preventDefault();
      }}
    >
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {missed && (
          <p className="border-b border-divider px-3 py-2 text-xs text-amber-700">
            {problem ?? `Nothing called “${query}” is available here.`} Pick one of these instead:
          </p>
        )}
        {items.length === 0 && <p className="px-3 py-2 text-xs text-dim">Nothing to insert here yet.</p>}
        {items.map((v, i) => (
          <div key={v.path}>
            {(i === 0 || items[i - 1].source !== v.source) && (
              <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-faint">{v.group}</p>
            )}
            <button
              type="button"
              data-active={i === active}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(v)}
              className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left', i === active && 'bg-hover')}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{v.label}</span>
                <span className="block truncate font-mono text-[11px] text-dim">{`{{${v.path}}}`}</span>
              </span>
              {(v.preview || v.type) && (
                <span className="max-w-[40%] shrink-0 truncate font-mono text-[11px] text-faint">{v.preview || v.type}</span>
              )}
            </button>
          </div>
        ))}
      </div>
      {!hasTriggerFields(variables) && <AddSample onDone={onSampleSaved} />}
      <p className="border-t border-divider px-3 py-1.5 text-[11px] text-faint">↑↓ to move · Enter to insert · Esc to close</p>
    </div>,
    document.body
  );
}

// Shown while the trigger has no known fields: paste the JSON your app sends.
function AddSample({ onDone }: { onDone: () => void }) {
  const { onSaveSample, sampleDraft } = useVariables();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(sampleDraft || '{\n  "name": "Ali",\n  "email": "ali@example.com"\n}');
  const [error, setError] = useState<string | null>(null);
  if (!onSaveSample) return null;

  const save = () => {
    try {
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Use a JSON object, e.g. { "name": "Ali" }');
      onSaveSample(value);
      toast.success('Trigger fields added');
      setOpen(false);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  return (
    <div className="border-t border-divider bg-subtle px-3 py-2">
      {!open ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-dim">The trigger has no fields yet.</p>
          <Button size="xs" variant="outline" data-keep-focus onClick={() => setOpen(true)}>
            Add trigger fields
          </Button>
        </div>
      ) : (
        <div className="grid gap-2">
          <p className="text-xs text-dim">Paste the JSON your app sends. It becomes {'{{input.…}}'} and is saved on the Trigger.</p>
          <Textarea
            autoFocus
            rows={5}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
            }}
            className="bg-surface font-mono text-xs"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button size="xs" data-keep-focus onClick={save}>
              Save fields
            </Button>
            <Button size="xs" variant="ghost" data-keep-focus onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TemplateInput(props: Omit<React.ComponentProps<'input'>, 'ref'>) {
  return <TemplateBox {...(props as TemplateProps)} />;
}

export function TemplateTextarea(props: Omit<React.ComponentProps<'textarea'>, 'ref'>) {
  return <TemplateBox {...(props as TemplateProps)} multiline />;
}

// The variable a field resolves to when it is exactly one reference ({{input.email}}).
export function variableFor(vars: Variable[], text: string) {
  const m = text.trim().match(/^\{\{\s*([\w.[\]$-]+)\s*\}\}$/);
  return m ? vars.find((v) => v.path === m[1]) : undefined;
}
