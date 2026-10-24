// Cloudflare Workers AI — бесплатные 10 000 «нейронов» в сутки (сброс в
// 00:00 UTC, общий лимит на все модели аккаунта). FLUX.2 [klein] 4B: лучшее
// бесплатное качество, принимает multipart/form-data, отдаёт JSON
// {result:{image: base64}}; 768×1344 ≈ 156 нейронов ≈ 60 картинок в сутки.
// Запасная — SDXL-Lightning (бета, $0): JSON на вход, PNG на выход.

import { getBytes } from "../http";
import { extFromBytes, imagePromptFor, seedFor } from "../query";
import { envNumber, MB } from "../util";
import { VisualError, type Candidate, type Stage, type StageInput, type VisualProvider } from "../types";

export const FLUX2 = "@cf/black-forest-labs/flux-2-klein-4b";
export const SDXL = "@cf/bytedance/stable-diffusion-xl-lightning";

const MULTIPART = new Set([FLUX2, "@cf/black-forest-labs/flux-2-klein-9b", "@cf/black-forest-labs/flux-2-dev"]);

const MODEL_TITLE: Record<string, string> = {
  [FLUX2]: "Cloudflare FLUX.2",
  [SDXL]: "Cloudflare SDXL-Lightning",
};

export function cfSize(format: StageInput["ctx"]["format"]): { width: number; height: number } {
  // Генерируем меньше кадра: дешевле в нейронах, Remotion масштабирует с Ken Burns.
  return format === "shorts" ? { width: 768, height: 1344 } : { width: 1344, height: 768 };
}

// Признак исчерпанной суточной квоты: 429 или ошибка 4006 в теле.
function isQuota(status: number, body: string): boolean {
  return status === 429 || /4006|daily free allocation|neurons/i.test(body);
}

async function runModel(input: StageInput, model: string, prompt: string): Promise<Buffer> {
  const { deps, key, ctx, scene } = input;
  const accountId = deps.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;
  const { width, height } = cfSize(ctx.format);
  const seed = seedFor(`${scene.id}|${prompt}`);
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  let body: BodyInit;
  if (MULTIPART.has(model)) {
    // FLUX.2 принимает только multipart; Content-Type с boundary ставит fetch сам.
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("width", String(width));
    form.append("height", String(height));
    form.append("seed", String(seed));
    body = form;
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ prompt, negative_prompt: "text, letters, watermark, logo, blurry, deformed", width, height, num_steps: 8, seed });
  }
  const timeout = envNumber(deps.env, "VISUALS_GEN_TIMEOUT_MS", 90_000);
  let res: { body: Buffer; contentType: string };
  try {
    res = await getBytes(deps.fetch, `Cloudflare ${model}`, url, { method: "POST", headers, body }, timeout, 20 * MB);
  } catch (e) {
    if (e instanceof VisualError && e.status !== null && isQuota(e.status, e.message)) {
      throw new VisualError(`Cloudflare: суточная бесплатная квота нейронов исчерпана (сброс в 00:00 UTC).`, { status: e.status, disable: true, cause: e });
    }
    throw e;
  }
  if (res.contentType.startsWith("image/")) return res.body; // SDXL отдаёт PNG напрямую
  let json: { success?: boolean; result?: { image?: string }; errors?: { code?: number; message?: string }[] };
  try {
    json = JSON.parse(res.body.toString("utf8"));
  } catch {
    const ext = extFromBytes(res.body, res.contentType);
    if (ext) return res.body; // картинка без правильного content-type
    throw new VisualError(`Cloudflare ${model}: неожиданный ответ.`);
  }
  if (!json.success || !json.result?.image) {
    const err = JSON.stringify(json.errors ?? json).slice(0, 200);
    if (isQuota(0, err)) throw new VisualError(`Cloudflare: суточная бесплатная квота нейронов исчерпана (сброс в 00:00 UTC).`, { disable: true });
    throw new VisualError(`Cloudflare ${model}: ошибка генерации: ${err}`);
  }
  return Buffer.from(json.result.image, "base64");
}

const stage: Stage = {
  rank: 0,
  media: "image",
  async run(input) {
    const prompt = imagePromptFor(input.scene, input.ctx.format, input.ctx.style ?? input.deps.env.VISUALS_STYLE);
    if (!prompt) return [];
    const override = input.deps.env.CLOUDFLARE_IMAGE_MODEL?.trim();
    const models = override ? [override] : [FLUX2, SDXL];
    let lastErr: unknown = null;
    for (const model of models) {
      try {
        const data = await runModel(input, model, prompt);
        const ext = extFromBytes(data);
        if (!ext) throw new VisualError(`Cloudflare ${model}: ответ — не картинка.`);
        const { width, height } = cfSize(input.ctx.format);
        const c: Candidate = {
          id: `cloudflare:${model}:${input.scene.id}`,
          type: "image",
          data,
          ext,
          width,
          height,
          credit: { provider: MODEL_TITLE[model] ?? `Cloudflare ${model}`, author: null, url: null },
        };
        return [c];
      } catch (e) {
        if (e instanceof VisualError && e.disable) throw e; // квота/ключ — дальше не пробуем
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new VisualError("Cloudflare: генерация не удалась.");
  },
};

export const cloudflareProvider: VisualProvider = {
  name: "cloudflare",
  title: "Cloudflare Workers AI",
  kind: "ai",
  keyEnv: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  signup: "https://dash.cloudflare.com/profile/api-tokens (токен с правами Workers AI Read + Edit)",
  stages: () => [stage],
};
