import { brand, designSystemAsset } from './index.js';

// Product copy only: never derive share metadata from a project, session or local URL.
const copy = {
  en: ['AI video editing & motion design', 'Create and edit videos with your AI agent. Refine an editable timeline, preview your work, and export videos while keeping the source.', 'en_US'],
  'zh-CN': ['AI 视频剪辑与动效设计', '与 AI Agent 一起创作和剪辑视频。在可编辑时间线上调整素材、预览效果并导出视频，保留完整工程源码。', 'zh_CN'],
  ja: ['AI 動画編集とモーションデザイン', 'AI エージェントと動画を制作・編集。編集可能なタイムラインで調整し、プレビューして書き出し、ソースも保存できます。', 'ja_JP'],
  ko: ['AI 영상 편집과 모션 디자인', 'AI 에이전트와 영상을 만들고 편집하세요. 편집 가능한 타임라인에서 조정하고 미리 본 뒤, 소스를 보존하며 영상을 내보내세요.', 'ko_KR'],
  de: ['KI-Videobearbeitung & Motion Design', 'Erstelle und bearbeite Videos mit deinem KI-Agenten. Verfeinere die Timeline, prüfe die Vorschau und exportiere Videos samt bearbeitbarem Quellprojekt.', 'de_DE'],
  fr: ['Montage vidéo IA et motion design', 'Créez et montez des vidéos avec votre agent IA. Affinez la timeline, prévisualisez et exportez vos vidéos en conservant le projet source.', 'fr_FR'],
  ru: ['Видеомонтаж с ИИ и моушн-дизайн', 'Создавайте и редактируйте видео с ИИ-агентом. Настраивайте таймлайн, просматривайте результат и экспортируйте видео, сохраняя исходный проект.', 'ru_RU'],
  es: ['Edición de vídeo con IA y diseño de movimiento', 'Crea y edita vídeos con tu agente de IA. Ajusta la línea de tiempo, previsualiza y exporta tus vídeos conservando el proyecto original.', 'es_ES'],
  'pt-BR': ['Edição de vídeo com IA e motion design', 'Crie e edite vídeos com seu agente de IA. Ajuste a linha do tempo, visualize e exporte vídeos preservando o projeto original.', 'pt_BR'],
  it: ['Montaggio video con IA e motion design', 'Crea e monta video con il tuo agente IA. Perfeziona la timeline, visualizza l’anteprima ed esporta i video conservando il progetto sorgente.', 'it_IT'],
  tr: ['Yapay zekâ ile video düzenleme ve hareket tasarımı', 'Yapay zekâ ajanınızla video oluşturun ve düzenleyin. Zaman çizelgesini ayarlayın, önizleyin ve kaynak projeyi koruyarak videoları dışa aktarın.', 'tr_TR'],
};

// Existing public, immutable brand artwork; dimensions verified against the original.
export const socialImage = Object.freeze({
  url: 'https://releases.open-design.ai/open-motion/media/sha256/9683e195639f5f6a54524f33fe4c7c3f4ec47efebb97fc93e4ec38895dd08412.jpg',
  width: 1280, height: 640, type: 'image/jpeg',
  alt: 'OpenMotion — Edit videos with your agent, on a blue and green painted landscape.',
});

export function pageMetadata(locale = 'zh-CN') {
  const [category, description, ogLocale] = copy[locale] ?? copy.en;
  const title = `${brand.productName} — ${category}`;
  return {
    title,
    name: { description, 'application-name': brand.productName, 'apple-mobile-web-app-title': brand.productName,
      robots: 'noindex, nofollow', 'color-scheme': 'light dark',
      'twitter:card': 'summary_large_image', 'twitter:title': title, 'twitter:description': description,
      'twitter:image': socialImage.url, 'twitter:image:alt': socialImage.alt },
    property: { 'og:type': 'website', 'og:site_name': brand.productName, 'og:title': title,
      'og:description': description, 'og:locale': ogLocale, 'og:image': socialImage.url,
      'og:image:secure_url': socialImage.url, 'og:image:type': socialImage.type,
      'og:image:width': String(socialImage.width), 'og:image:height': String(socialImage.height), 'og:image:alt': socialImage.alt },
  };
}

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const faviconLinks = () => [
  `<link rel="icon" type="image/png" sizes="32x32" href="${designSystemAsset('brand/favicon-32.png')}" />`,
  `<link rel="icon" type="image/svg+xml" sizes="any" href="${designSystemAsset(brand.favicon)}?v=2" />`,
  `<link rel="apple-touch-icon" sizes="180x180" href="${designSystemAsset('brand/apple-touch-icon.png')}" />`,
].join('\n');

/** Static HTML and the hydrated UI use the same copy, including no-JS startup/errors. */
export function renderPageMetadata(locale = 'zh-CN', surface = 'studio') {
  const meta = pageMetadata(locale);
  if (surface === 'design-system') {
    meta.title = 'OpenMotion · Design System';
    meta.name.description = 'OpenMotion 共享设计系统：颜色、字体、组件、图标与品牌资源。';
    meta.name['twitter:title'] = meta.property['og:title'] = meta.title;
    meta.name['twitter:description'] = meta.property['og:description'] = meta.name.description;
  }
  return [
    `<title>${escape(meta.title)}</title>`,
    ...['name', 'property'].flatMap(attribute => Object.entries(meta[attribute]).map(([key, value]) =>
      `<meta ${attribute}="${key}" content="${escape(value)}" />`)),
    faviconLinks(),
  ].join('\n');
}
