// Formatting helpers: seconds -> "3d 4h", bytes -> "48.2 MB", time -> "12 min ago".
import { getLang, t } from "./i18n.js";

const locale = () => (getLang() === "ja" ? "ja-JP" : "en-US");

export function formatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(locale()).format(n);
}

/** 273600 -> "3d 4h" (en) / "3日4時間" (ja). Shows the two largest units. */
export function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || totalSeconds < 0) return "—";
  const s = Math.floor(totalSeconds);
  const units = [
    ["d", Math.floor(s / 86400)],
    ["h", Math.floor((s % 86400) / 3600)],
    ["m", Math.floor((s % 3600) / 60)],
    ["s", s % 60],
  ];
  const first = units.findIndex(([, v]) => v > 0);
  if (first === -1) return t("fmt.duration.s", { n: 0 });
  return units
    .slice(first, first + 2)
    .filter(([, v], i) => i === 0 || v > 0)
    .map(([u, v]) => t(`fmt.duration.${u}`, { n: v }))
    .join(t("fmt.duration.sep"));
}

/** Bytes with binary steps, labelled KB/MB/GB as most people expect. */
export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  return `${v.toFixed(digits)} ${units[i]}`;
}

/** Unix seconds -> "12 minutes ago". */
export function timeAgo(unixSeconds, nowMs = Date.now()) {
  if (!unixSeconds) return "—";
  const diff = Math.round(unixSeconds - nowMs / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 45) return rtf.format(diff, "second");
  if (abs < 45 * 60) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 36 * 3600) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 60 * 86400) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 700 * 86400) return rtf.format(Math.round(diff / (30 * 86400)), "month");
  return rtf.format(Math.round(diff / (365 * 86400)), "year");
}

export function formatDateTime(unixSeconds) {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString(locale(), {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** 0.987654 -> "98.76%". Never rounds up to 100% before it really is. */
export function formatPercent(fraction) {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return "—";
  const pct = Math.floor(Math.max(0, Math.min(1, fraction)) * 10000) / 100;
  return `${pct.toFixed(2)}%`;
}

/** "0000000881...3bee1ef6" */
export function shortHash(hash, head = 8, tail = 8) {
  if (!hash) return "—";
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** Human name for a chain value from getblockchaininfo. */
export function chainName(chain) {
  if (!chain) return "—";
  const map = { main: "mainnet", bitcoin: "mainnet", test: "testnet3", testnet: "testnet3" };
  return map[chain] || chain;
}
