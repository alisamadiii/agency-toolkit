'use client';

import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';

import { cn } from '@/lib/utils';

// CodeMirror needs the browser; import this through `next/dynamic` with ssr: false.
export default function CodeEditor({
  value,
  onChange,
  language = 'javascript',
  height = '320px',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  language?: 'javascript' | 'json';
  height?: string;
  className?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-md border text-xs', className)}>
      <CodeMirror
        value={value}
        onChange={onChange}
        height={height}
        theme="light"
        extensions={[language === 'json' ? json() : javascript({ typescript: true }), EditorView.lineWrapping]}
        basicSetup={{ foldGutter: false, highlightActiveLine: false }}
      />
    </div>
  );
}
