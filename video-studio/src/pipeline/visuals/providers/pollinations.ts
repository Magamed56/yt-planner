// Pollinations — старый бесключевой эндпоинт image.pollinations.ai. Он не
// документирован, без SLA и условий; новый gen.pollinations.ai требует ключ и
// платные «Pollen». Поэтому — только по явному согласию через VISUALS и
// только как последний вариант, по принципу «повезёт — хорошо».

import { getBytes } from "../http";
import { extFromBytes, imagePromptFor, seedFor } from "../query";
import { envNumber, MB } from "../util";
import { VisualError, type Stage, type VisualProvider } from "../types";
import { cfSize } from "./cloudflare";

// Бесплатный лимит — «1 image every 45 seconds per IP» (HTTP 402/429, «Retry after 40s»):
// ждём, сколько просят, и повторяем — иначе из 8 сцен картинку получала бы только первая.
// POLLINATIONS_WAIT_MAX_SEC — сколько всего ждать на сцену (по умолчанию 100 с, 0 — не ждать).
async function withFreeLimitRetry<T>(run: () => Promise<T>, env: Record<string, string | undefined>): Promise<T> {
  let budget = envNumber(env, "POLLINATIONS_WAIT_MAX_SEC", 100);
  for (;;) {
    try {
      return await run();
    } catch (e) {
      const limited = e instanceof VisualError && (e.status === 402 || e.status === 429) && /FREE_LIMIT|retry after/i.test(e.message);
      const waitSec = limited ? Math.min(60, Number(/retry after (\d+)/i.exec(e.message)?.[1] ?? 45) + 2) : 0;
      if (!limited || waitSec > budget) throw e;
      budget -= waitSec;
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }
  }
}

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
    const res = await withFreeLimitRetry(() => getBytes(deps.fetch, "Pollinations", url, {}, timeout, 20 * MB), deps.env);
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
