"use client";
// Карточка «Уведомления на телефон» (Web Push): включить на этом устройстве, проверить, выключить.
// Самодостаточна: состояние берёт из /api/push, сервис-воркер регистрирует только по «Включить».
// На iPhone push есть только у панели, открытой со значка на экране «Домой» (iOS 16.4+).
import { useCallback, useEffect, useState } from "react";
import styles from "./PushCard.module.css";

interface Device {
  id: string;
  label: string;
  addedAt: string;
}

interface Status {
  configured: boolean;
  problems: string[];
  publicKey: string | null;
  devices: Device[];
  max: number;
  storageError: string | null;
}

interface Env {
  ios: boolean;
  standalone: boolean;
  supported: boolean;
}

type Phase = "loading" | "unsupported" | "old-ios" | "ios-browser" | "denied" | "off" | "on" | "stale";
type Busy = "enable" | "disable" | "test" | null;
type Reply = { ok: boolean; message: string } & Partial<Status>;

const PHASE: Record<Phase, { text: string; tone: "ok" | "warn" | "dim" }> = {
  loading: { text: "проверяю…", tone: "dim" },
  unsupported: { text: "браузер не умеет", tone: "dim" },
  "old-ios": { text: "нужен iOS 16.4+", tone: "warn" },
  "ios-browser": { text: "откройте со значка", tone: "warn" },
  denied: { text: "запрещены", tone: "warn" },
  off: { text: "выключены", tone: "dim" },
  on: { text: "включены здесь", tone: "ok" },
  stale: { text: "подписка устарела", tone: "warn" },
};

const IOS_HINT = "сначала «Поделиться» → «На экран „Домой“», затем откройте панель со значка";

function environment(): Env {
  const ua = navigator.userAgent;
  // iPad в режиме «как на компьютере» представляется Mac — выдаёт его сенсорный экран.
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return { ios, standalone, supported };
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)) return "iPad";
  const device = /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Устройство";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /YaBrowser\//.test(ua) ? "Яндекс Браузер" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${device} · ${browser}` : device;
}

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (key.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  return x.every((v, i) => v === b[i]);
}

// Тот же отпечаток адреса подписки, что считает сервер (sha256 → base64url, 16 знаков).
async function deviceIdOf(endpoint: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  let s = "";
  for (const b of digest) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 16);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function call(url: string, body?: unknown): Promise<Reply> {
  try {
    const res = await fetch(
      url,
      body === undefined
        ? { cache: "no-store", signal: AbortSignal.timeout(30_000) }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) },
    );
    const j = (await res.json().catch(() => null)) as (Partial<Reply> & { error?: string }) | null;
    const message = j?.message || j?.error || (res.status === 401 ? "Вход истёк — обновите страницу и войдите снова." : `Панель ответила ${res.status}.`);
    return { ...(j ?? {}), ok: res.ok && j?.ok !== false, message };
  } catch (e) {
    const timeout = e instanceof DOMException && e.name === "TimeoutError";
    return { ok: false, message: timeout ? "Панель не ответила за 30 секунд — попробуйте ещё раз." : "Нет связи с панелью — проверьте интернет." };
  }
}

function browserError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError") return "Браузер не разрешил уведомления — проверьте разрешение для панели в настройках.";
  if (name === "AbortError" || name === "InvalidStateError") return "Служба уведомлений браузера не ответила — попробуйте ещё раз через минуту.";
  if (name === "SecurityError") return "Уведомления работают только по https — откройте панель по её адресу на Vercel.";
  return e instanceof Error ? e.message : String(e);
}

const deniedHelp = (ios: boolean) =>
  ios
    ? "Уведомления для панели запрещены. Разрешите: Настройки iPhone → Уведомления → панель → «Допуск уведомлений», затем откройте панель со значка заново."
    : "Уведомления для панели запрещены в браузере. Разрешите: значок слева от адреса → Уведомления → «Разрешить», затем обновите страницу.";

const dayLabel = (iso: string) => (Number.isFinite(Date.parse(iso)) ? `с ${new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}` : "");

export default function PushCard() {
  const [env, setEnv] = useState<Env | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [myId, setMyId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const e = environment();
    setEnv(e);
    const res = await call("/api/push");
    const st = res.ok ? (res as unknown as Status) : null;
    setStatus(st);
    setLoadError(res.ok ? null : res.message);
    if (!e.supported) {
      setPhase(e.ios ? (e.standalone ? "old-ios" : "ios-browser") : "unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPhase("denied");
      return;
    }
    try {
      const sub = await currentSubscription();
      const id = sub ? await deviceIdOf(sub.endpoint) : null;
      setMyId(id);
      // Браузер подписан, а сервер устройства не знает (убрали из списка, сменили ключи) — «устарела».
      setPhase(!id ? "off" : !st || st.devices.some((d) => d.id === id) ? "on" : "stale");
    } catch {
      setPhase("off");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function enable() {
    if (!status?.publicKey || busy) return;
    setBusy("enable");
    setNote(null);
    try {
      // iOS показывает запрос разрешения только прямо из нажатия — до любых других ожиданий.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setNote({ ok: false, text: permission === "denied" ? deniedHelp(env?.ios ?? false) : "Разрешение не дано — нажмите «Включить» и выберите «Разрешить»." });
        return;
      }
      await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const reg = await navigator.serviceWorker.ready;
      const key = keyBytes(status.publicKey);
      let sub = await reg.pushManager.getSubscription();
      // Подписку со старым ключом VAPID служба push не примет — пересоздаём.
      if (sub && !sameBytes(sub.options.applicationServerKey, key)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const res = await call("/api/push/subscribe", { subscription: sub.toJSON(), label: deviceLabel() });
      setNote({ ok: res.ok, text: res.ok ? `${res.message} Нажмите «Проверить».` : res.message });
    } catch (e) {
      setNote({ ok: false, text: browserError(e) });
    } finally {
      setBusy(null);
      await load();
    }
  }

  async function disable() {
    if (busy) return;
    setBusy("disable");
    setNote(null);
    try {
      const sub = await currentSubscription();
      if (sub) {
        const res = await call("/api/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
        setNote(
          res.ok
            ? { ok: true, text: res.message }
            : { ok: false, text: `На устройстве выключены, а список на сервере не обновился (${res.message}) — он поправится сам при следующей отправке.` },
        );
      }
    } catch (e) {
      setNote({ ok: false, text: browserError(e) });
    } finally {
      setBusy(null);
      await load();
    }
  }

  async function test() {
    if (busy) return;
    setBusy("test");
    setNote(null);
    try {
      const sub = await currentSubscription();
      const res = sub ? await call("/api/push/test", { endpoint: sub.endpoint }) : { ok: false, message: "Сначала нажмите «Включить»." };
      setNote({ ok: res.ok, text: res.message });
    } catch (e) {
      setNote({ ok: false, text: browserError(e) });
    } finally {
      setBusy(null);
      await load();
    }
  }

  const { text, tone } = PHASE[phase];
  const canEnable = Boolean(status?.configured && status.publicKey);
  const iosApp = env?.ios && env.standalone;

  return (
    <section className={`card ${styles.card}`} aria-labelledby="push-card-title">
      <div className={styles.head}>
        <h2 id="push-card-title" className={styles.title}>
          Уведомления на телефон
        </h2>
        <span className={styles.status} data-tone={tone}>
          {text}
        </span>
      </div>
      <p className="muted small">Утром — дела на сегодня: что загрузить в Studio и до какого дня хватит расписания. После сборки — «видео готово».</p>

      {loadError && <p className="error-text small">{loadError}</p>}

      {status && !status.configured && (
        <div className={styles.box} data-tone="warn">
          <b>Сервер ещё не готов слать уведомления.</b>
          {status.problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <ol>
            <li>
              На компьютере, в папке <code>video-studio</code>: <code>npx tsx panel/scripts/vapid-keys.ts</code>
            </li>
            <li>Строки, которые он напечатает, — в Vercel → Settings → Environment Variables (в VAPID_SUBJECT — ваша почта).</li>
            <li>Deployments → ⋯ → Redeploy, затем обновите эту страницу.</li>
          </ol>
        </div>
      )}

      {phase === "ios-browser" && (
        <div className={styles.box} data-tone="accent">
          <b>На iPhone уведомления приходят только в панель со значка.</b>
          <p>Как включить: {IOS_HINT} и нажмите «Включить».</p>
        </div>
      )}
      {phase === "old-ios" && (
        <div className={styles.box} data-tone="warn">
          Уведомления от сайтов появились в iOS 16.4 — обновите iPhone (Настройки → Основные → Обновление ПО) и откройте панель со значка снова.
        </div>
      )}
      {phase === "unsupported" && <div className={styles.box}>Этот браузер не умеет push-уведомления — откройте панель в Safari, Chrome, Edge или Firefox.</div>}
      {phase === "denied" && (
        <div className={styles.box} data-tone="warn">
          {deniedHelp(env?.ios ?? false)}
        </div>
      )}
      {phase === "stale" && <p className="small">Браузер подписан, но сервер это устройство не знает (подписку убрали или сменили ключи) — нажмите «Включить» ещё раз.</p>}

      {(phase === "off" || phase === "stale" || phase === "on") && (
        <div className={`btn-row ${styles.buttons}`}>
          {phase === "on" ? (
            <button type="button" className="btn primary" onClick={test} disabled={busy !== null}>
              {busy === "test" ? "Отправляю…" : "Проверить"}
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={enable} disabled={!canEnable || busy !== null}>
              {busy === "enable" ? "Включаю…" : "Включить"}
            </button>
          )}
          {phase !== "off" && (
            <button type="button" className="btn ghost" onClick={disable} disabled={busy !== null}>
              {busy === "disable" ? "Выключаю…" : "Выключить"}
            </button>
          )}
        </div>
      )}
      <div role="status" aria-live="polite">
        {note && <p className={`small ${note.ok ? styles.okText : "error-text"}`}>{note.text}</p>}
      </div>

      {status?.storageError && <p className="small error-text">Список устройств не прочитан: {status.storageError}</p>}
      {status && status.devices.length > 0 && (
        <div className={styles.devices}>
          <h3 className="small muted">
            Устройства · {status.devices.length} из {status.max}
          </h3>
          <ul>
            {status.devices.map((d) => (
              <li key={d.id}>
                <span>
                  {d.label}
                  {d.id === myId && <b className={styles.me}> · это устройство</b>}
                </span>
                <span className="muted small">{dayLabel(d.addedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase !== "ios-browser" && !iosApp && <p className="muted small">На iPhone: {IOS_HINT}.</p>}
    </section>
  );
}
