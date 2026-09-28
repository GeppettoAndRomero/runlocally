import type { Locale } from '../i18n/locales';
export const workbenchStrings: Record<Locale, Record<string, string>> = {
  ja: {
    input: '入力', choose: 'アーカイブを選択', busy: '処理中です。完了後に入力してください。', single: '1つのアーカイブを選んでください。',
    large: '入力は1 GB以下にしてください。', unknown: '形式を確認できません。ZIP、RAR、7z、tar を選んでください。',
    source: '入力ファイル', browse: '閲覧', extract: '取り出し', entries: '総エントリ数', files: 'ファイル数', eligible: '抽出可能件数',
    name: '名前', size: 'サイズ', previous: '前へ', next: '次へ', page: 'ページ', all: '全件', one: '1件', chooseOne: '取り出し対象に選ぶ', run: '取り出す',
    results: '結果', save: '保存', saveFile: 'ファイルを保存', reinput: 'この結果を次の入力にする', reinputFile: '次の入力にする', count: '件', listingError: '一覧の取得に失敗しました。',
    jobError: '取り出しに失敗しました。再実行できます。', encrypted: '暗号化ファイルとディレクトリは全件取り出しから除外されます。',
    duplicate: '同名の項目は、1件取り出しで最初の一致が使われます。', reset: 'リセット', progress: '進捗',
  },
  en: {
    input: 'Input', choose: 'Choose an archive', busy: 'Processing. Try another input when it finishes.', single: 'Choose one archive.',
    large: 'Input must be 1 GB or less.', unknown: 'Format could not be identified. Choose ZIP, RAR, 7z, or tar.',
    source: 'Source file', browse: 'Browse', extract: 'Extract', entries: 'Total entries', files: 'Files', eligible: 'Extractable files',
    name: 'Name', size: 'Size', previous: 'Previous', next: 'Next', page: 'Page', all: 'All', one: 'One', chooseOne: 'Select for extraction', run: 'Extract',
    results: 'Results', save: 'Save', saveFile: 'Save file', reinput: 'Use this result as the next input', reinputFile: 'Use as next input', count: ' files', listingError: 'Could not list this archive.',
    jobError: 'Extraction failed. You can retry.', encrypted: 'Encrypted files and directories are excluded from Extract all.',
    duplicate: 'For duplicate names, Extract one uses the first match.', reset: 'Reset', progress: 'Progress',
  },
};
