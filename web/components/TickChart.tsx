'use client';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function TickChart({ data }: { data: { t: string; p: number }[] }) {
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={40} />
          <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={40} />
          <Tooltip formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} />
          <Line type="monotone" dataKey="p" stroke="#4f46e5" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
