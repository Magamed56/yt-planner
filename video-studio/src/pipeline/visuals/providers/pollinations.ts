// Pollinations — старый бесключевой эндпоинт image.pollinations.ai. Он не
// документирован, без SLA и условий; новый gen.pollinations.ai требует ключ и
// платные «Pollen». Поэтому — только по явному согласию через VISUALS и
// только как последний вариант, по принципу «повезёт — хорошо».

import { getBytes } from "../http";
import { extFromBytes, imagePromptFor, seedFor } from "../query";
import { envNumber, MB } from "../util";
import { VisualError, type Stage, type VisualProvider } from "../types";
import { cfSize } from "./cloudflare";

const stage: Stage = {
  rank: 0,
  media: "image",
  async run(input) {
    const { deps, ctx, scene } = input;
    const prompt = imagePromptFor(scene, ctx.format, deps.env.VISUALS_STYLE);
    if (!prompt) return [];
    const { width, height } = cfSize(ctx.format);
    const q = new URLSearchParams({ width: String(width), height: String(height), seed: String(seedFor(`${scene.id}|${prompt}`)), model: "flux", nologo: "true" });
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}?${q}`;
    const timeout = envNumber(deps.env, "VISUALS_GEN_TIMEOUT_MS", 90_000);
    const res = await getBytes(deps.fetch, "Pollinations", url, {}, timeout, 20 * MB);
    const ext = extFromBytes(res.body, res.contentType);
    if (!ext || !res.contentType.startsWith("image/")) throw new VisualError("Pollinations: ответ — не картинка (эндпоинт мог измениться).");
    return [
      {
        id: `pollinations:${scene.id}`,
        type: "image",
        data: res.body,
        ext,
        width,
        height,
        credit: { provider: "Pollinations", author: null, url: "https://pollinations.ai" },
      },
    ];
  },
};

export const pollinationsProvider: VisualProvider = {
  name: "pollinations",
  title: "Pollinations",
  kind: "ai",
  keyEnv: [],
  signup: "",
  stages: () => [stage],
};
