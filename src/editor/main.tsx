import { render } from 'preact';
import { EditorApp } from './EditorApp';
import { doc, validation } from './store';
import { showPendingNotice } from './project';
import './editor.css';

render(<EditorApp />, document.getElementById('editor')!);
showPendingNotice();

if (import.meta.env.DEV || new URLSearchParams(location.search).has('test')) {
  (window as unknown as { __trackEditor: unknown }).__trackEditor = { doc, validation };
}
