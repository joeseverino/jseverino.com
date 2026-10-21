// node --test reporter for the gate: one line on a pass; on a failure, the whole run through
// Node's own spec reporter, so every failure prints in full. Node ships no reporter that is
// quiet on a pass (dot prints a row per twenty tests).
import { Readable } from 'node:stream';
import { spec, type TestEvent } from 'node:test/reporters';

export default async function* quiet(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  const events: TestEvent[] = [];
  let summary: Extract<TestEvent, { type: 'test:summary' }>['data'] | undefined;
  for await (const event of source) {
    events.push(event);
    if (event.type === 'test:summary' && event.data.file === undefined) summary = event.data;
  }
  if (summary?.success) {
    const { tests, skipped, todo } = summary.counts;
    yield `ok       ${tests} tests pass${skipped || todo ? ` (${skipped} skipped, ${todo} todo)` : ''}\n`;
    return;
  }
  for await (const chunk of Readable.from(events).compose(spec())) yield String(chunk);
}
