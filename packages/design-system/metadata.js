import { brand, designSystemAsset } from './index.js';

// Product copy only: never derive share metadata from a project, session or local URL.
const copy = {
  en: ['Create motion videos with AI agents. Generate images & video, music and voiceovers; edit and animate, recreate viral videos and ads, and build with brand video templates and design systems.', 'en_US'],
  'zh-CN': ['与 AI Agent 一起制作动效视频：生成图片、视频、音乐与配音，剪辑视频、制作动画，复刻热门视频和广告。结合品牌视频模板与品牌设计系统，从创意到成片，保留可编辑工程。', 'zh_CN'],
  ja: ['AI エージェントとモーション動画を制作。画像・動画・音楽・ナレーションの生成から編集・アニメーションまで。話題の動画や広告を再現し、ブランド動画テンプレートとデザインシステムで仕上げます。', 'ja_JP'],
  ko: ['AI 에이전트와 모션 영상을 만드세요. 이미지·영상·음악·내레이션 생성부터 편집과 애니메이션까지. 인기 영상과 광고를 재현하고 브랜드 영상 템플릿과 디자인 시스템으로 완성하세요.', 'ko_KR'],
  de: ['Erstelle Motion-Videos mit KI-Agenten: Bilder, Videos, Musik und Voiceovers generieren, schneiden und animieren. Gestalte virale Videos und Werbung nach und nutze Markenvorlagen und Designsysteme.', 'de_DE'],
  fr: ['Créez des vidéos animées avec des agents IA : images, vidéos, musique, voix off, montage et animation. Recréez des vidéos virales et des publicités avec des modèles vidéo de marque et des systèmes de design.', 'fr_FR'],
  ru: ['Создавайте моушн-видео с ИИ-агентами: изображения, видео, музыку и озвучку, монтаж и анимацию. Воссоздавайте популярные ролики и рекламу с видеошаблонами брендов и дизайн-системами.', 'ru_RU'],
  es: ['Crea vídeos animados con agentes de IA: imágenes, vídeo, música, voz en off, edición y animación. Recrea vídeos virales y anuncios con plantillas de vídeo de marca y sistemas de diseño.', 'es_ES'],
  'pt-BR': ['Crie vídeos de motion design com agentes de IA: imagens, vídeo, música, narração, edição e animação. Recrie vídeos virais e anúncios com templates de vídeo de marcas e sistemas de design.', 'pt_BR'],
  it: ['Crea video animati con agenti IA: immagini, video, musica, voci fuori campo, montaggio e animazione. Ricrea video virali e pubblicità con modelli video di brand e sistemi di design.', 'it_IT'],
  tr: ['Yapay zekâ ajanlarıyla hareketli videolar oluşturun: görsel, video, müzik ve seslendirme üretin; düzenleyin ve canlandırın. Viral videoları ve reklamları marka video şablonları ve tasarım sistemleriyle yeniden oluşturun.', 'tr_TR'],
};

// Existing public, immutable brand artwork; dimensions verified against the original.
export const socialImage = Object.freeze({
  url: 'https://releases.open-design.ai/open-motion/media/sha256/9683e195639f5f6a54524f33fe4c7c3f4ec47efebb97fc93e4ec38895dd08412.jpg',
  width: 1280, height: 640, type: 'image/jpeg',
  alt: 'OpenDesign Motion social preview with a blue and green painted landscape.',
});

export function pageMetadata(locale = 'zh-CN') {
  const [description, ogLocale] = copy[locale] ?? copy.en;
  const title = `${brand.website.name} — ${brand.website.tagline}`;
  return {
    title,
    name: { description, 'application-name': brand.website.name, 'apple-mobile-web-app-title': brand.website.name,
      robots: 'noindex, nofollow', 'color-scheme': 'light dark',
      'twitter:card': 'summary_large_image', 'twitter:title': title, 'twitter:description': description,
      'twitter:image': socialImage.url, 'twitter:image:alt': socialImage.alt },
    property: { 'og:type': 'website', 'og:site_name': brand.website.name, 'og:title': title,
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
    meta.title = `${brand.website.name} · Design System`;
    meta.name.description = `${brand.website.name} 共享设计系统：颜色、字体、组件、图标与品牌资源。`;
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
