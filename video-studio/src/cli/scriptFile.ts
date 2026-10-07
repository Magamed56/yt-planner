// Загрузка сценария из JSON-файла (свой, отредактированный черновик или демо)
// с понятными сообщениями: «не найден», «не JSON», список проблем схемы.
import fs from "node:fs";
import type { VideoScript } from "../types";
import { validateScript } from "../pipeline/script/index";
import { UserError, rel, resolveInputPath } from "./common";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function loadScriptFile(file: string): VideoScript {
  const abs = resolveInputPath(file);
  if (!abs) throw new UserError(`Файл сценария не найден: ${file}`);
  let json: unknown;
  try {
    // BOM в начале — частый подарок Блокнота Windows.
    json = JSON.parse(fs.readFileSync(abs, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    throw new UserError(`${rel(abs)}: это не JSON (${errText(e)}). Проверьте запятые и кавычки — например, на jsonlint.com.`);
  }
  try {
    return validateScript(json);
  } catch (e) {
    throw new UserError(`Файл ${rel(abs)}:\n${errText(e)}\nИсправьте и запустите снова (формат — как в examples/demo-ru.json).`);
  }
}
