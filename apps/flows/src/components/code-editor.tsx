'use client';

import { javascript, typescriptLanguage } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { useMemo } from 'react';

import { cn } from '@/lib/utils';

export type CodeCompletion = { path: string; label: string; detail?: string };

// The bits of CodeMirror's CompletionContext we use (the package isn't a direct dependency).
type CompletionContext = {
  explicit: boolean;
  matchBefore: (re: RegExp) => { from: number; to: number; text: string } | null;
};

// Paths a Code node can read: input.x, nodes.<id>.output.x, secrets.X, run.x.
const PATH_BEFORE = /\b(?:input|nodes|secrets|run)(?:\.[\w$]*|\[\d*\]?)*$/;

function completionSource(items: CodeCompletion[]) {
  // Keys with "-" need bracket syntax in JS; leave those to the {{ }} fields.
  const options = items
    .filter((i) => !i.path.includes('-'))
    .map((i) => ({ label: i.path, detail: i.detail, info: i.label, type: 'variable' }));
  return (ctx: CompletionContext) => {
    const word = ctx.matchBefore(PATH_BEFORE);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    return { from: word.from, options, validFor: /^[\w$.[\]]*$/ };
  };
}

// CodeMirror needs the browser; import this through `next/dynamic` with ssr: false.
export default function CodeEditor({
  value,
  onChange,
  language = 'javascript',
  height = '320px',
  className,
  completions,
}: {
  value: string;
  onChange: (value: string) => void;
  language?: 'javascript' | 'json';
  height?: string;
  className?: string;
  // Suggested data paths (input.…, nodes.….output.…) while typing.
  completions?: CodeCompletion[];
}) {
  const extensions = useMemo(
    () => [
      language === 'json' ? json() : javascript({ typescript: true }),
      ...(language === 'javascript' && completions?.length
        ? [typescriptLanguage.data.of({ autocomplete: completionSource(completions) })]
        : []),
      EditorView.lineWrapping,
    ],
    [language, completions]
  );
  return (
    <div className={cn('overflow-hidden rounded-md border text-xs', className)}>
      <CodeMirror
        value={value}
        onChange={onChange}
        height={height}
        theme="light"
        extensions={extensions}
        basicSetup={{ foldGutter: false, highlightActiveLine: false }}
      />
    </div>
  );
}
