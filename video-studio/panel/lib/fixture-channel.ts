// Канал для офлайн-тестов и демо «Доски»: настоящий channel.json, но расписание — то, по которому в
// проверках посчитаны ожидаемые даты: 2 Shorts в день (12:00, 19:00) и «Разборы» вт/чт/сб в 21:00 МСК
// (так было до 13.10.2026). Своё расписание, а не текущее из channel.json: его смена не должна ломать
// проверки логики очереди, ориентиров и запаса. Текущее расписание канала проверяет src/dev/long-test.ts.
export const FIXTURE_SCHEDULE = { perDay: 2, publishTimesLocal: ["12:00", "19:00"], timezone: "Europe/Moscow" };
export const FIXTURE_LONG_SLOTS = { days: ["tue", "thu", "sat"], time: "21:00" };

export function withFixtureSchedule(channelJson: unknown): Record<string, unknown> {
  const raw = channelJson && typeof channelJson === "object" && !Array.isArray(channelJson) ? (channelJson as Record<string, unknown>) : {};
  return { ...raw, schedule: { ...FIXTURE_SCHEDULE }, longSlots: { ...FIXTURE_LONG_SLOTS } };
}
