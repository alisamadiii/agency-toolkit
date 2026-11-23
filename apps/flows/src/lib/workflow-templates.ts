import type { Graph } from '@/lib/schemas';

// Starting points for "New workflow".

export const BLANK: Graph = {
  nodes: [{ id: 'trigger', type: 'trigger', name: 'Trigger', position: { x: 0, y: 120 }, config: {} }],
  edges: [],
};

// Call an API, branch on the status code, and shape the result on each branch.
export const EXAMPLE: Graph = {
  nodes: [
    { id: 'trigger', type: 'trigger', name: 'Trigger', position: { x: 0, y: 120 }, config: {} },
    {
      id: 'fetch',
      type: 'http',
      name: 'Fetch data',
      position: { x: 300, y: 120 },
      config: {
        method: 'GET',
        url: 'https://httpbin.org/json',
        headers: {},
        timeoutSec: 30,
        retries: 0,
        continueOnError: true,
      },
    },
    {
      id: 'ok',
      type: 'if',
      name: 'Status is 200?',
      position: { x: 600, y: 120 },
      config: { conditions: [{ left: '{{nodes.fetch.output.status}}', op: 'equals', right: '200' }], combine: 'and' },
    },
    {
      id: 'summarize',
      type: 'code',
      name: 'Summarize',
      position: { x: 920, y: 30 },
      config: {
        code: 'export default async ({ nodes }) => {\n  const slides = nodes.fetch.output.body.slideshow.slides;\n  console.log(`found ${slides.length} slides`);\n  return { title: nodes.fetch.output.body.slideshow.title, slides: slides.length };\n};\n',
        timeoutSec: 30,
        retries: 0,
        continueOnError: false,
      },
    },
    {
      id: 'report_error',
      type: 'code',
      name: 'Report error',
      position: { x: 920, y: 220 },
      config: {
        code: 'export default async ({ nodes }) => ({ failed: true, detail: nodes.fetch.output });\n',
        timeoutSec: 30,
        retries: 0,
        continueOnError: false,
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'trigger', target: 'fetch', sourceHandle: null },
    { id: 'e2', source: 'fetch', target: 'ok', sourceHandle: null },
    { id: 'e3', source: 'ok', target: 'summarize', sourceHandle: 'true' },
    { id: 'e4', source: 'ok', target: 'report_error', sourceHandle: 'false' },
  ],
};

