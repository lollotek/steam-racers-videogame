/**
 * Title screen → Playtest tuning: load a tuning file written with an AI assistant, download the
 * kit to give the assistant (guide + defaults, built from the live registry), export, reset.
 */
import { useState } from 'preact/hooks';
import { tunables } from '../core/tunables';
import { buildTuningFile, parseTuning, type ParsedTuning } from '../core/tuning-file';
import { DEFAULTS_FILENAME, GUIDE_FILENAME, buildDefaultsFile, buildGuideMarkdown } from '../tuning/guide';
import { activeTuning, setTuning, tuningSummary } from '../tuning/active';

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'tuning';

interface Result {
  ok: boolean;
  text: string;
  warnings: string[];
}

export function TuningPanel({ onBack }: { onBack: () => void }) {
  const active = activeTuning.value;
  const [paste, setPaste] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const load = (text: string) => {
    let parsed: ParsedTuning;
    try {
      parsed = parseTuning(text, tunables);
    } catch (e) {
      setResult({ ok: false, text: `Not a valid tuning: ${(e as Error).message}`, warnings: [] });
      return;
    }
    if (Object.keys(parsed.file.params).length === 0) {
      setResult({ ok: false, text: 'No usable parameters in this file.', warnings: parsed.warnings });
      return;
    }
    setTuning(parsed.file);
    setPaste(null);
    setResult({ ok: true, text: `Loaded "${tuningSummary(parsed.file)}".`, warnings: parsed.warnings });
  };

  const pickFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.txt,application/json,text/plain';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) load(await f.text());
    };
    input.click();
  };

  const downloadKit = () => {
    download(GUIDE_FILENAME, buildGuideMarkdown(tunables), 'text/markdown');
    download(DEFAULTS_FILENAME, `${JSON.stringify(buildDefaultsFile(tunables), null, 2)}\n`, 'application/json');
  };

  const saveCurrent = () => {
    if (!active) return;
    const f = buildTuningFile(tunables, { name: active.name, notes: active.notes, author: active.author });
    download(`${slug(active.name)}.json`, `${JSON.stringify(f, null, 2)}\n`, 'application/json');
  };

  return (
    <div class="tuning-panel" data-testid="tuning-panel">
      <div class={`tuning-status ${active ? 'on' : ''}`} data-testid="tuning-status">
        {active ? (
          <>
            <strong>Active: {tuningSummary(active)}</strong>
            {active.author && <span class="dim"> · by {active.author}</span>}
            {active.notes && <p class="tuning-notes">{active.notes}</p>}
          </>
        ) : (
          <strong>Default values</strong>
        )}
      </div>

      {result && (
        <div class={`tuning-result ${result.ok ? 'ok' : 'bad'}`} data-testid="tuning-result">
          <p>{result.text}</p>
          {result.warnings.length > 0 && (
            <ul>
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {paste !== null ? (
        <div class="tuning-paste">
          <textarea
            data-testid="tuning-textarea"
            placeholder="Paste the JSON from the AI assistant here"
            value={paste}
            onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)}
            rows={8}
          />
          <div class="menu-row">
            <button class="btn small" data-nav data-testid="tuning-apply" disabled={!paste.trim()} onClick={() => load(paste)}>
              Apply
            </button>
            <button class="btn small ghost" data-nav onClick={() => setPaste(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div class="menu-list">
          <button class="menu-item" data-nav data-autofocus data-testid="tuning-load" onClick={pickFile}>
            <span class="menu-label">Load file</span>
            <span class="menu-hint">A .json tuning file from the AI assistant</span>
          </button>
          <button
            class="menu-item"
            data-nav
            data-testid="tuning-paste"
            onClick={() => {
              setPaste('');
              setResult(null);
            }}
          >
            <span class="menu-label">Paste JSON</span>
            <span class="menu-hint">Copy the assistant's answer and paste it (text around the JSON is fine)</span>
          </button>
          <button class="menu-item" data-nav data-testid="tuning-kit" onClick={downloadKit}>
            <span class="menu-label">Download AI kit</span>
            <span class="menu-hint">Guide + default values: attach both to ChatGPT, Claude, Gemini…</span>
          </button>
          {active && (
            <>
              <button class="menu-item" data-nav data-testid="tuning-export" onClick={saveCurrent}>
                <span class="menu-label">Save current tuning</span>
                <span class="menu-hint">To send to the developers with your feedback</span>
              </button>
              <button
                class="menu-item"
                data-nav
                data-testid="tuning-reset"
                onClick={() => {
                  setTuning(null);
                  setResult({ ok: true, text: 'Back to the default values.', warnings: [] });
                }}
              >
                <span class="menu-label">Reset to defaults</span>
              </button>
            </>
          )}
        </div>
      )}
      <button class="btn ghost" data-nav onClick={onBack}>
        Back
      </button>
    </div>
  );
}
