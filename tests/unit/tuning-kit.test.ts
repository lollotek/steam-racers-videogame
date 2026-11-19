/**
 * Keeps docs/tuning/ (the LLM tuning kit) in sync with the registry.
 * After changing tunables run `npm run tuning:kit` to rewrite the files.
 */
import { describe, expect, it } from 'vitest';
import '../../src/game/game';
import { tunables } from '../../src/core/tunables';
import { parseTuning } from '../../src/core/tuning-file';
import { DEFAULTS_FILENAME, GUIDE_FILENAME, buildDefaultsFile, buildGuideMarkdown } from '../../src/tuning/guide';

describe('tuning kit', () => {
  it('defaults file is current and reads back without warnings', async () => {
    const json = `${JSON.stringify(buildDefaultsFile(tunables), null, 2)}\n`;
    expect(parseTuning(json, tunables).warnings).toEqual([]);
    await expect(json).toMatchFileSnapshot(`../../docs/tuning/${DEFAULTS_FILENAME}`);
  });

  it('guide is current and lists every parameter', async () => {
    const md = buildGuideMarkdown(tunables);
    for (const k of Object.keys(buildDefaultsFile(tunables).params)) expect(md).toContain(`\`${k}\``);
    await expect(md).toMatchFileSnapshot(`../../docs/tuning/${GUIDE_FILENAME}`);
  });
});
