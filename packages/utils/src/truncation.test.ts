import { describe, expect, it } from 'vitest';
import { buildOutputMetadata } from './truncation.js';

describe('buildOutputMetadata', () => {
  it('does not treat a complete short answer without a conclusion label as truncated', () => {
    const metadata = buildOutputMetadata('北京。', 'stop', 8192, 2);
    expect(metadata.containsFinalConclusion).toBe(false);
    expect(metadata.incomplete).toBe(false);
    expect(metadata.incompleteReasons).toBeUndefined();
  });

  it('keeps genuine length truncation marked incomplete', () => {
    const metadata = buildOutputMetadata('正在继续', 'length', 100, 100);
    expect(metadata.truncated).toBe(true);
    expect(metadata.incomplete).toBe(true);
    expect(metadata.incompleteReasons).toContain('finish_reason is length (hit max_tokens)');
  });

  it('accepts a complete fenced JSON answer and still rejects an unclosed fence', () => {
    const complete = buildOutputMetadata('```json\n{"ok":true}\n```', 'stop', 90000, 20);
    expect(complete.containsCodeBlock).toBe(true);
    expect(complete.truncated).toBe(false);
    expect(complete.incomplete).toBe(false);

    const incomplete = buildOutputMetadata('```json\n{"ok":true}', 'stop', 90000, 20);
    expect(incomplete.truncated).toBe(true);
    expect(incomplete.incompleteReasons).toContain('unclosed code fence');
  });
});
