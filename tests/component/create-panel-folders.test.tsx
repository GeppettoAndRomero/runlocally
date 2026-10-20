import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { CreatePanel } from '../../src/app/panels/create.panel';
import type { PanelProps } from '../../src/app/panels';
import { initialSession } from '../../src/app/state/reducer';
import { createUi, ui } from '../../src/i18n/ui';

vi.mock('../../src/app/registerSW', () => ({ isUpdateApplying: () => false }));
afterEach(() => { cleanup(); vi.clearAllMocks(); delete window.__toolReady; });

const t = createUi.en;
function setup() {
  const onCreate = vi.fn();
  const onCreateSelectionChange = vi.fn();
  const props: PanelProps = { session: initialSession(0, 'create'), locale: 'en', t: ui.en.workbench,
    active: true, busy: false, updating: false, publish: vi.fn(), onNavigate: vi.fn(), onRun: vi.fn(),
    onCreate, onCreateSelectionChange };
  render(<CreatePanel {...props} />);
  return { onCreate, onCreateSelectionChange };
}
function file(name: string, path = '', size = 1, lastModified = 1) {
  const value = new File(['x'], name, { lastModified });
  Object.defineProperties(value, { webkitRelativePath: { value: path }, size: { value: size } });
  return value;
}
function chooseFolder(files: File[]) {
  fireEvent.change(screen.getByLabelText(t.addFolder), { target: { files } });
}
function chooseFiles(files: File[]) {
  fireEvent.change(screen.getByLabelText(t.addFiles), { target: { files } });
}
const names = () => [...document.querySelectorAll('.workbench__name')].map(node => node.textContent);

it('keeps folder files that share a name, size and time but live in different folders', () => {
  const { onCreate } = setup();
  chooseFolder([file('readme.txt', 'a/readme.txt'), file('readme.txt', 'b/readme.txt'), file('.gitkeep', 'a/.gitkeep', 0), file('.gitkeep', 'b/.gitkeep', 0)]);
  expect(names()).toEqual(['a/readme.txt', 'b/readme.txt', 'a/.gitkeep', 'b/.gitkeep']);
  expect(screen.getByRole('heading', { name: `${t.selectedCount}: 4` })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t.run }));
  expect(onCreate.mock.calls[0][0].map((item: File) => item.webkitRelativePath)).toEqual(['a/readme.txt', 'b/readme.txt', 'a/.gitkeep', 'b/.gitkeep']);
});

it('adds the same folder file only once when the same folder is chosen again', () => {
  setup();
  chooseFolder([file('readme.txt', 'a/readme.txt'), file('notes.txt', 'a/notes.txt')]);
  chooseFolder([file('readme.txt', 'a/readme.txt'), file('notes.txt', 'a/notes.txt'), file('readme.txt', 'b/readme.txt')]);
  expect(names()).toEqual(['a/readme.txt', 'a/notes.txt', 'b/readme.txt']);
});

it('keeps a file at the same relative path when its size or time differs, as from another folder of the same name', () => {
  const { onCreate } = setup();
  const first = file('readme.txt', 'docs/readme.txt', 10, 1);
  const otherSize = file('readme.txt', 'docs/readme.txt', 20, 1);
  const otherTime = file('readme.txt', 'docs/readme.txt', 10, 2);
  chooseFolder([first]);
  chooseFolder([otherSize, otherTime, file('readme.txt', 'docs/readme.txt', 10, 1)]);
  expect(names()).toEqual(['docs/readme.txt', 'docs/readme.txt', 'docs/readme.txt']);
  fireEvent.click(screen.getByRole('button', { name: t.run }));
  expect(onCreate.mock.calls[0][0]).toEqual([first, otherSize, otherTime]);
});

it('treats files without a relative path as the same only when name, size and time all match', () => {
  setup();
  chooseFiles([file('one.txt'), file('one.txt'), file('one.txt', '', 2), file('one.txt', '', 1, 2)]);
  expect(names()).toEqual(['one.txt', 'one.txt', 'one.txt']);
});

it('does not merge a loose file with a folder file of the same name, size and time', () => {
  setup();
  chooseFiles([file('readme.txt')]);
  chooseFolder([file('readme.txt', 'a/readme.txt')]);
  expect(names()).toEqual(['readme.txt', 'a/readme.txt']);
});
