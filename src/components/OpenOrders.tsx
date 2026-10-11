"use client";
import { OrderActions } from "./PositionActions";
import type { OrderView } from "./state";
import { SideTag, VenueBadge, cents, relTime } from "./ui";

const WORKING = new Set(["submitted", "open", "partially_filled"]);
export const workingOrders = (orders: OrderView[]) => orders.filter((o) => WORKING.has(o.status));

export function OpenOrders({ orders, onChanged }: { orders: OrderView[]; onChanged: () => void }) {
  const working = workingOrders(orders);
  if (working.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <ul className="divide-y divide-line">
        {working.map((o) => {
          const filled = o.quantity > 0 ? o.filledQuantity / o.quantity : 0;
          return (
            <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
              <div className="min-w-0 flex-1 basis-56">
                <div className="truncate text-sm font-medium text-fg">{o.marketTitle ?? o.marketId}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <span className="font-medium text-fg-2">{o.action === "buy" ? "Buy" : "Sell"}</span>
                  <SideTag side={o.side} />
                  <span className="num">{o.quantity} @ {cents(o.limitPrice)} limit</span>
                  <VenueBadge venue={o.venue} />
                  <span>· {relTime(o.createdAt)}</span>
                </div>
              </div>
              <div className="w-28">
                <div className="num flex justify-between text-[11px] text-muted">
                  <span>Filled</span>
                  <span>{o.filledQuantity}/{o.quantity}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${filled * 100}%` }} />
                </div>
              </div>
              <OrderActions order={o} onDone={onChanged} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
