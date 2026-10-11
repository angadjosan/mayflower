"use client";
import { OrderActions } from "./PositionActions";
import type { OrderView } from "./state";
import { Chip, Ring, SideTag, SimulatedChip, cents, relTime } from "./ui";

const WORKING = new Set(["submitted", "open", "partially_filled"]);
export const workingOrders = (orders: OrderView[]) => orders.filter((o) => WORKING.has(o.status));

export function OpenOrders({ orders, onChanged }: { orders: OrderView[]; onChanged: () => void }) {
  const working = workingOrders(orders);
  if (working.length === 0) return null;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {working.map((o) => {
        const filled = o.quantity > 0 ? o.filledQuantity / o.quantity : 0;
        return (
          <li key={o.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <Ring value={filled} size={34} stroke={3.5} color="var(--accent)" label={`${o.filledQuantity} of ${o.quantity} filled`}>
              <span className="num text-[9px] font-semibold text-fg-2">{Math.round(filled * 100)}</span>
            </Ring>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-fg">{o.marketTitle ?? o.marketId}</div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <Chip className="h-5 px-1.5 text-[11px]">{o.action === "buy" ? "Buy" : "Sell"}</Chip>
                <SideTag side={o.side} />
                <span className="num">{o.quantity} @ {cents(o.limitPrice)}</span>
                {o.mode === "simulated" && <SimulatedChip />}
                <span className="hidden sm:inline">· {relTime(o.createdAt)}</span>
              </div>
            </div>
            <OrderActions order={o} onDone={onChanged} />
          </li>
        );
      })}
    </ul>
  );
}
