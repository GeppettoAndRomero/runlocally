import type { Locale } from '@/i18n/locales';

import type { UiStrings } from '@/i18n/types';

export const strings: Record<Locale, UiStrings['shared']> = {
  ja: {
    required: '必須', close: '閉じる', themeLabel: 'テーマ', themeToLight: '明るいテーマに切り替え', themeToDark: '暗いテーマに切り替え',
    dropTitle: 'ファイルをドロップ', dropHint: 'ファイルやフォルダをここに移動', processing: 'ファイルを確認中: {count} 件', wait: 'しばらくお待ちください',
    installTitle: 'アプリをインストール', installBody: 'この端末に追加できます。', install: 'インストール', later: '後で',
  },
  en: {
    required: 'Required', close: 'Close', themeLabel: 'Theme', themeToLight: 'Switch to light theme', themeToDark: 'Switch to dark theme',
    dropTitle: 'Drop files', dropHint: 'Move files or folders here', processing: 'Checking files: {count}', wait: 'Please wait',
    installTitle: 'Install app', installBody: 'Add this app to this device.', install: 'Install', later: 'Later',
  },
};
