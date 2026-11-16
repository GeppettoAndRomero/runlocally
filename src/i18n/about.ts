import { checkMetadataLength } from '../seo/page';
import { LOCALES, type Locale } from './locales';

export interface AboutContent {
  title: string;
  description: string;
  h1: string;
  lead: string;
  operation: string;
  disclosure: string;
  verificationHeading: string;
  verificationSteps: readonly [string, string, string, string];
  linksHeading: string;
  sourceLink: string;
  issuesLink: string;
  securityLink: string;
  securityNote: string;
  footerLink: string;
}

export const abouts: Record<Locale, AboutContent> = {
  ja: {
    title: 'runlocally について | runlocally',
    description: '端末内の ZIP 操作と JPG／PNG 画像変換を提供する runlocally の運営、AI 支援、通信とオフラインの確認手順。',
    h1: 'runlocally について',
    lead: 'runlocally は、端末内で ZIP を操作し、画像を JPG／PNG に変換するブラウザアプリです。',
    operation: '無料で使えるブラウザアプリとして、匿名で運営しています。',
    disclosure: 'コードの一部は AI の支援で書かれています。レビューと判断はすべて運営者が行っています。',
    verificationHeading: '通信とオフラインを確認するには',
    verificationSteps: [
      'ページを読み込む前に DevTools の Network で記録を開始します。読み込みと初期資産の取得、Service Worker（SW）の precache（事前保存）の完了を待ちます。',
      'ファイルの入力・操作・保存を行い、通信先とリクエスト内容を見ます。初期取得や SW 更新などの通信と、入力データの送信を混同しないでください。',
      "文書応答の CSP に connect-src 'self' があることを確認します。これは同一オリジンへの送信を禁じる設定ではなく、CSP 単独で「一切送信しない」と証明することはできません。",
      '初回保存完了と SW 制御開始を確認した後、DevTools を Offline にして再読み込みします。旧 SW に about がなければ、新しい SW の保存・適用後までこのページはオフラインで使えません。この確認は OS へのインストール完了を保証しません。',
    ],
    linksHeading: 'ソースと連絡先',
    sourceLink: 'ソースコード（GitHub）',
    issuesLink: '不具合・ご意見（GitHub Issues）',
    securityLink: '脆弱性の報告（Security）',
    securityNote: '一般的な不具合・ご意見は Issues へ、脆弱性は Security に記載された非公開の報告経路へお寄せください。外部サイトへのアクセスはリンクを開いたときに行われます。',
    footerLink: 'このサイトについて',
  },
  en: {
    title: 'About runlocally | runlocally',
    description: 'About runlocally: on-device ZIP tools, JPG/PNG conversion, anonymous operation, AI assistance and verification steps.',
    h1: 'About runlocally',
    lead: 'runlocally is a browser app for ZIP operations and image conversion to JPG or PNG on your device.',
    operation: 'This free browser app is operated anonymously.',
    disclosure: 'AI assistance contributed to some code. The maintainer is responsible for all review and decisions.',
    verificationHeading: 'How to check communication and offline use',
    verificationSteps: [
      'Start recording in DevTools Network before loading the page. Wait for loading, initial assets and Service Worker (SW) precache to complete.',
      'Input files, perform operations and save results, then inspect destinations and request contents. Distinguish initial downloads and SW updates from transmission of input data.',
      "Check the document response CSP for connect-src 'self'. This does not prohibit same-origin transmission; CSP alone cannot prove that nothing is sent.",
      'After initial saving completes and SW control begins, switch DevTools to Offline and reload. If an old SW lacks about, this page is unavailable offline until the new SW is saved and applied. This check does not guarantee OS installation completion.',
    ],
    linksHeading: 'Source and contact',
    sourceLink: 'Source code (GitHub)',
    issuesLink: 'Bugs and feedback (GitHub Issues)',
    securityLink: 'Report a vulnerability (Security)',
    securityNote: 'Use Issues for general bugs and feedback. Report vulnerabilities through the private channels in Security. External sites are accessed when you open their links.',
    footerLink: 'About this site',
  },
};

const keys = ['title', 'description', 'h1', 'lead', 'operation', 'disclosure', 'verificationHeading',
  'verificationSteps', 'linksHeading', 'sourceLink', 'issuesLink', 'securityLink', 'securityNote', 'footerLink'] as const;
export function validateAbouts(value: Record<Locale, AboutContent>): void {
  if (Object.keys(value).length !== LOCALES.length) throw new Error('Unexpected about locale');
  for (const { code } of LOCALES) {
    const content = value[code];
    if (!content || Object.keys(content).length !== keys.length || !keys.every(key => {
      const field = content[key];
      return key === 'verificationSteps'
        ? Array.isArray(field) && field.length === 4 && Array.from(field).every(step => typeof step === 'string' && step.trim())
        : typeof field === 'string' && field.trim();
    })) throw new Error(`Missing about content: ${code}`);
    checkMetadataLength(code, 'about', content.title, content.description);
  }
}

validateAbouts(abouts);

export function aboutContent(locale: Locale): AboutContent {
  const content = abouts[locale];
  if (!content) throw new Error(`Missing about content: ${locale}`);
  return content;
}
