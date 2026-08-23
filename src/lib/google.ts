import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

const TOKEN_ROW_ID = "singleton";

// Приложение личное, однопользовательское — храним один токен на всё
// приложение, а не токен на пользователя.
function makeOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

export function getAuthUrl() {
  const client = makeOAuthClient();
  return client.generateAuthUrl({
    // offline + prompt=consent — иначе Google не всегда отдаёт refresh_token
    // повторно, если доступ уже был выдан раньше.
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = makeOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token || !tokens.access_token || !tokens.expiry_date) {
    throw new Error("Google не вернул refresh_token — попробуй отключить доступ в аккаунте Google и подключить заново");
  }
  client.setCredentials(tokens);

  // Название канала — просто чтобы показать "подключено как …" в интерфейсе.
  const youtube = google.youtube({ version: "v3", auth: client });
  const channelsRes = await youtube.channels.list({ part: ["snippet"], mine: true });
  const channelTitle = channelsRes.data.items?.[0]?.snippet?.title ?? null;

  await prisma.googleAuthToken.upsert({
    where: { id: TOKEN_ROW_ID },
    create: {
      id: TOKEN_ROW_ID,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: new Date(tokens.expiry_date),
      channelTitle,
    },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: new Date(tokens.expiry_date),
      channelTitle,
    },
  });
}

export async function getConnectionStatus() {
  const row = await prisma.googleAuthToken.findUnique({ where: { id: TOKEN_ROW_ID } });
  return row ? { connected: true as const, channelTitle: row.channelTitle } : { connected: false as const };
}

export async function disconnectGoogle() {
  await prisma.googleAuthToken.deleteMany({ where: { id: TOKEN_ROW_ID } });
}

// Клиент с актуальным токеном — обновляет access_token через refresh_token
// автоматически и сохраняет новый обратно в базу, если он поменялся.
export async function getAuthenticatedClient() {
  const row = await prisma.googleAuthToken.findUnique({ where: { id: TOKEN_ROW_ID } });
  if (!row) throw new Error("YouTube не подключён");

  const client = makeOAuthClient();
  client.setCredentials({
    access_token: row.accessToken,
    refresh_token: row.refreshToken,
    expiry_date: row.expiryDate.getTime(),
  });

  client.on("tokens", async (tokens) => {
    if (!tokens.access_token) return;
    await prisma.googleAuthToken.update({
      where: { id: TOKEN_ROW_ID },
      data: {
        accessToken: tokens.access_token,
        expiryDate: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      },
    });
  });

  return client;
}
