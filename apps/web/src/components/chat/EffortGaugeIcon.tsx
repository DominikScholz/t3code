import { cn } from "~/lib/utils";
import type { ComposerControlSize } from "./ComposerControl";

// Lucide's gauge: a 240° arc around (12, 14). The needle sweeps most of it, stopping short
// of the arc ends so the lowest and highest levels stay distinguishable from the frame.
const NEEDLE_SWEEP_DEGREES = 200;
const UNKNOWN_LEVEL_DEGREES = 45;
// Speed lines sit left of the gauge, so a fast icon is 30 units wide instead of 24.
const SPEED_OFFSET = 6;

export type EffortGaugeSpeed = "fast" | "ultrafast";

export function EffortGaugeIcon({
  level,
  speed = null,
  ultracode = false,
  size = "sm",
}: {
  /** Position within the model's effort range, 0 to 1. */
  level: number | null;
  speed?: EffortGaugeSpeed | null;
  ultracode?: boolean;
  size?: ComposerControlSize;
}) {
  const degrees = level === null ? UNKNOWN_LEVEL_DEGREES : (level - 0.5) * NEEDLE_SWEEP_DEGREES;
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={speed ? `0 0 ${24 + SPEED_OFFSET} 24` : "0 0 24 24"}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // A size- class opts out of parents' square svg sizing; the important width then widens it.
      className={cn(
        "shrink-0",
        size === "xs" ? (speed ? "size-3 w-3.75!" : "size-3") : speed ? "size-4 w-5!" : "size-4",
      )}
      data-composer-control-icon
    >
      {speed ? (
        <>
          <path d="M3 8h7" />
          <path d="M1 12h4.5" />
          {speed === "ultrafast" ? (
            <path d="M2.5 15.2v2.3a1.75 1.75 0 0 0 3.5 0v-2.3" strokeWidth={1.7} />
          ) : (
            <path d="M3 16h2.5" />
          )}
        </>
      ) : null}
      <g transform={speed ? `translate(${SPEED_OFFSET} 0)` : undefined}>
        <path d="M3.34 19a10 10 0 1 1 17.32 0" />
        <path
          d="M12 14V8.34"
          style={{ transform: `rotate(${degrees}deg)`, transformOrigin: "12px 14px" }}
          className="transition-transform duration-200 ease-out motion-reduce:transition-none"
        />
        {ultracode ? (
          <g fill="currentColor" stroke="none">
            <circle cx="8" cy="21.2" r="1.3" />
            <circle cx="12" cy="21.2" r="1.3" />
            <circle cx="16" cy="21.2" r="1.3" />
          </g>
        ) : null}
      </g>
    </svg>
  );
}
