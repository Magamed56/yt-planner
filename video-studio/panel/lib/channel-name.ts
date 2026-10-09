// Название канала для манифеста и заголовков — из video-studio/channel.json, вшивается при сборке:
// манифест и иконки открыты без входа и не должны зависеть от GitHub API. Сменили название —
// нужен новый деплой.
import channelJson from "../../channel.json";
import { channelFromJson } from "../../src/pipeline/channel";

export const CHANNEL_NAME = channelFromJson(channelJson).name ?? "Канал";
