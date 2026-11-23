'use client';

import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter } from '@codemirror/lint';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { useTheme } from 'next-themes';

import { cn } from '@/lib/utils';

// Small JSON code editor: syntax highlighting, auto-closing brackets/braces,
// and auto-indent on newline (all from CodeMirror's json() + default keymaps).
export function JsonEditor({
  value,
  onChange,
  placeholder,
  className,
  minHeight = '80px',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
}) {
  const { resolvedTheme } = useTheme();

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border bg-transparent text-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40',
        className
      )}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        minHeight={minHeight}
        extensions={[
          json(),
          // Red underline on invalid JSON while typing.
          linter(jsonParseLinter()),
          // Force token colors regardless of the UI theme.
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
        ]}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          // closeBrackets, bracketMatching and indentOnInput stay on (defaults)
          // — that's what gives auto-closing braces and auto-indent.
        }}
      />
    </div>
  );
}
