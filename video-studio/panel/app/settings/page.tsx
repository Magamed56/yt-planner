// Настройки этого устройства: пока — уведомления на телефон. Страница за паролем (proxy.ts),
// данные карточка берёт сама из /api/push.
import Link from "next/link";
import PushCard from "@/components/PushCard";
import { CHANNEL_NAME } from "@/lib/channel-name";
import styles from "./settings.module.css";

export const metadata = { title: `Настройки — ${CHANNEL_NAME}` };

export default function SettingsPage() {
  return (
    <main className={styles.wrap}>
      <header className={styles.top}>
        <h1>Настройки</h1>
        <Link href="/" className="btn small ghost">
          ← В панель
        </Link>
      </header>
      <PushCard />
    </main>
  );
}
