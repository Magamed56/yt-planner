import React from "react";
import { Folder, Still } from "remotion";
import { Avatar } from "./Avatar";
import { Banner } from "./Banner";
import { pillarById } from "./data";
import { Highlight } from "./Highlight";
import { IntroPost } from "./IntroPost";
import { BRAND_STILLS as S } from "./jobs";
import { SmallSizePreview } from "./SmallSizePreview";
import { Watermark } from "./Watermark";

// Статичные картинки бренда канала (аватар, баннер, обложки, пост).
// Рендер всех разом — `npm run brand`; в Studio — папка «Brand».
export const BrandStills: React.FC = () => (
  <Folder name="Brand">
    <Still id={S.avatarYoutube.id} component={Avatar} width={S.avatarYoutube.width} height={S.avatarYoutube.height} />
    <Still id={S.avatarInstagram.id} component={Avatar} width={S.avatarInstagram.width} height={S.avatarInstagram.height} />
    <Still id={S.banner.id} component={Banner} width={S.banner.width} height={S.banner.height} defaultProps={{ guides: false }} />
    <Still id={S.bannerPreview.id} component={Banner} width={S.bannerPreview.width} height={S.bannerPreview.height} defaultProps={{ guides: true }} />
    <Still id={S.watermark.id} component={Watermark} width={S.watermark.width} height={S.watermark.height} />
    <Still id={S.highlight.id} component={Highlight} width={S.highlight.width} height={S.highlight.height} defaultProps={{ pillar: pillarById(undefined).id }} />
    <Still id={S.introPost.id} component={IntroPost} width={S.introPost.width} height={S.introPost.height} />
    <Still id={S.smallPreview.id} component={SmallSizePreview} width={S.smallPreview.width} height={S.smallPreview.height} />
  </Folder>
);
