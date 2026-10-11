// Список бренд-картинок: id композиции → файл в brand/ (brand/<язык>/) и размер. Чистый TS
// без React — его читают и Root.tsx (регистрация <Still>), и CLI в Node
// (`npm run brand`), чтобы размеры и имена файлов жили в одном месте. Переименовали файл —
// поправьте и кнопки панели (panel/lib/brand-kit.ts; сверяет panel/scripts/brand-kit-test.ts).
import type { VideoProps } from "../../types";

export interface BrandStill {
  id: string; // id композиции Remotion (латиница, цифры, дефис)
  width: number;
  height: number;
}

export const BRAND_STILLS = {
  avatarYoutube: { id: "Brand-Avatar-YouTube", width: 800, height: 800 },
  avatarInstagram: { id: "Brand-Avatar-Instagram", width: 1080, height: 1080 },
  banner: { id: "Brand-Banner", width: 2560, height: 1440 },
  bannerPreview: { id: "Brand-Banner-Preview", width: 2560, height: 1440 },
  watermark: { id: "Brand-Watermark", width: 150, height: 150 },
  highlight: { id: "Brand-Highlight", width: 1080, height: 1920 },
  introPost: { id: "Brand-Intro-Post", width: 1080, height: 1350 },
  smallPreview: { id: "Brand-Small-Preview", width: 1600, height: 760 },
} satisfies Record<string, BrandStill>;

// Ключ inputProps, в котором передают файл канала: `npm run brand` (channel.json или
// channels/<язык>.json) и конвейер роликов (props.json другого языка — для бренд-заставки);
// читает его data.ts через getInputProps(). Нет ключа — channel.json из бандла.
// satisfies — имя ключа не разойдётся с полем VideoProps.
export const BRAND_CHANNEL_PROP = "brandChannel" satisfies keyof VideoProps;

export interface BrandJob {
  group: string; // для --only=avatar,banner,…
  compositionId: string;
  file: string; // путь внутри brand/, через «/»
  inputProps?: Record<string, unknown>;
  // false — не сжимать в 256 цветов (водяной знак: прозрачность и мелкие детали).
  compress?: boolean;
}

// highlights — по одной обложке на рубрику из файла канала.
export function brandJobs(pillarIds: string[]): BrandJob[] {
  const S = BRAND_STILLS;
  return [
    { group: "avatar", compositionId: S.avatarYoutube.id, file: "avatar-youtube.png" },
    { group: "avatar", compositionId: S.avatarInstagram.id, file: "avatar-instagram.png" },
    { group: "banner", compositionId: S.banner.id, file: "banner-youtube.png" },
    { group: "banner", compositionId: S.bannerPreview.id, file: "banner-safe-preview.png" },
    { group: "watermark", compositionId: S.watermark.id, file: "watermark-youtube.png", compress: false },
    ...pillarIds.map((id) => ({ group: "highlights", compositionId: S.highlight.id, file: `highlights/${id}.png`, inputProps: { pillar: id } })),
    { group: "post", compositionId: S.introPost.id, file: "instagram-post-intro.png" },
    { group: "preview", compositionId: S.smallPreview.id, file: "avatar-preview.png" },
  ];
}
