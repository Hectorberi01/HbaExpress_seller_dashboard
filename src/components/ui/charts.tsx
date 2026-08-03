"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * `label` est ce que l'utilisateur LIT ; `key` ce sur quoi on FILTRE.
 *
 * Les deux étaient confondus tant que les libellés venaient tels quels du serveur. Dès
 * lors qu'on les traduit — « Draft » devient « Brouillon » —, cliquer sur une part
 * enverrait « Brouillon » comme valeur de filtre, que l'API ne reconnaît pas. `key`
 * conserve donc la valeur d'origine ; sans elle, `label` fait toujours foi.
 */
export type ChartPoint = { label: string; value: number; key?: string };

// Système de coordonnées interne fixe ; le SVG se met à l'échelle via viewBox.
const VW = 640;
const PAD = { top: 16, right: 16, bottom: 28, left: 52 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function useScales(data: ChartPoint[], height: number) {
  return useMemo(() => {
    const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
    const innerW = VW - PAD.left - PAD.right;
    const innerH = height - PAD.top - PAD.bottom;
    const n = data.length;
    const xFor = (i: number) =>
      n <= 1 ? PAD.left + innerW / 2 : PAD.left + (i / (n - 1)) * innerW;
    const bandW = n > 0 ? innerW / n : innerW;
    const xBand = (i: number) => PAD.left + i * bandW;
    const yFor = (v: number) => PAD.top + innerH - (v / max) * innerH;
    return { max, innerW, innerH, xFor, xBand, bandW, yFor };
  }, [data, height]);
}

function xTicks(n: number): number[] {
  if (n <= 6) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil(n / 6);
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  if (out[out.length - 1] !== n - 1) out.push(n - 1);
  return out;
}

function Grid({ max, innerH, yFor, fmt }: { max: number; innerH: number; yFor: (v: number) => number; fmt: (v: number) => string }) {
  const lines = 4;
  return (
    <g>
      {Array.from({ length: lines + 1 }, (_, i) => {
        const v = (max / lines) * i;
        const y = yFor(v);
        return (
          <g key={i}>
            <line x1={PAD.left} x2={VW - PAD.right} y1={y} y2={y} stroke="currentColor" className="text-border" strokeWidth={1} />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">{fmt(v)}</text>
          </g>
        );
      })}
    </g>
  );
}

/** Graphe ligne + aire (tendance). */
export function LineChart({ data, formatValue = (v) => v.toLocaleString("fr-FR"), height = 220, className }: {
  data: ChartPoint[];
  formatValue?: (v: number) => string;
  height?: number;
  className?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const { max, innerH, xFor, yFor } = useScales(data, height);
  const [active, setActive] = useState<number | null>(null);

  if (data.length === 0) return <EmptyChart height={height} className={className} />;

  const pts = data.map((d, i) => `${xFor(i)},${yFor(d.value)}`).join(" ");
  const area = `M ${xFor(0)},${yFor(0)} L ${pts.split(" ").join(" L ")} L ${xFor(data.length - 1)},${yFor(0)} Z`;

  return (
    <ChartFrame height={height} className={className} data={data} xAt={xFor} active={active} setActive={setActive} formatValue={formatValue}>
      <defs>
        <linearGradient id={`g-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.28" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <Grid max={max} innerH={innerH} yFor={yFor} fmt={formatValue} />
      <path d={area} fill={`url(#g-${gid})`} />
      <polyline points={pts} fill="none" stroke="hsl(var(--primary))" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {active != null && (
        <>
          <line x1={xFor(active)} x2={xFor(active)} y1={PAD.top} y2={height - PAD.bottom} stroke="hsl(var(--primary))" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
          <circle cx={xFor(active)} cy={yFor(data[active].value)} r={5} fill="hsl(var(--primary))" stroke="#fff" strokeWidth={2} />
        </>
      )}
      <XLabels data={data} xAt={xFor} height={height} />
    </ChartFrame>
  );
}

/** Graphe en barres. */
export function BarChart({ data, formatValue = (v) => v.toLocaleString("fr-FR"), height = 220, className }: {
  data: ChartPoint[];
  formatValue?: (v: number) => string;
  height?: number;
  className?: string;
}) {
  const { max, innerH, xBand, bandW, yFor } = useScales(data, height);
  const [active, setActive] = useState<number | null>(null);

  if (data.length === 0) return <EmptyChart height={height} className={className} />;

  const centerAt = (i: number) => xBand(i) + bandW / 2;
  const bw = Math.max(4, bandW * 0.6);

  return (
    <ChartFrame height={height} className={className} data={data} xAt={centerAt} active={active} setActive={setActive} formatValue={formatValue}>
      <Grid max={max} innerH={innerH} yFor={yFor} fmt={formatValue} />
      {data.map((d, i) => {
        const y = yFor(d.value);
        const x = centerAt(i) - bw / 2;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={bw}
            height={Math.max(0, height - PAD.bottom - y)}
            rx={4}
            className={cn("transition-opacity", active != null && active !== i ? "opacity-50" : "")}
            fill="hsl(var(--primary))"
          />
        );
      })}
      <XLabels data={data} xAt={centerAt} height={height} />
    </ChartFrame>
  );
}

// ---- éléments partagés -----------------------------------------------------

function XLabels({ data, xAt, height }: { data: ChartPoint[]; xAt: (i: number) => number; height: number }) {
  return (
    <g>
      {xTicks(data.length).map((i) => (
        <text key={i} x={xAt(i)} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          {data[i].label}
        </text>
      ))}
    </g>
  );
}

function ChartFrame({ data, xAt, active, setActive, formatValue, height, className, children }: {
  data: ChartPoint[];
  xAt: (i: number) => number;
  active: number | null;
  setActive: (i: number | null) => void;
  formatValue: (v: number) => string;
  height: number;
  className?: string;
  children: React.ReactNode;
}) {
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VW;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < data.length; i++) {
      const d = Math.abs(xAt(i) - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    setActive(best);
  }

  const tip = active != null ? { left: (xAt(active) / VW) * 100, d: data[active] } : null;

  return (
    <div className={cn("relative w-full", className)}>
      <svg viewBox={`0 0 ${VW} ${height}`} className="w-full" style={{ height }} onMouseMove={onMove} onMouseLeave={() => setActive(null)} role="img">
        {children}
      </svg>
      {tip && (
        <div
          className="nm-elevated pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-lg bg-white px-2.5 py-1.5 text-xs"
          style={{ left: `${Math.min(88, Math.max(12, tip.left))}%` }}
        >
          <div className="font-medium">{tip.d.label}</div>
          <div className="tabular-nums text-muted-foreground">{formatValue(tip.d.value)}</div>
        </div>
      )}
    </div>
  );
}

function EmptyChart({ height, className }: { height: number; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center text-sm text-muted-foreground", className)} style={{ height }}>
      Aucune donnée sur la période.
    </div>
  );
}

// ---- Sparkline (mini-tendance sans axes) -----------------------------------

export function Sparkline({ values, height = 34, className, color = "hsl(var(--primary))" }: {
  values: number[];
  height?: number;
  className?: string;
  color?: string;
}) {
  const w = 120;
  if (!values.length) return <div style={{ height }} className={className} />;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => (values.length <= 1 ? w / 2 : pad + (i / (values.length - 1)) * (w - 2 * pad));
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - 2 * pad);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className={cn("w-full", className)} style={{ height }} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---- Multi-séries (lignes superposées, même échelle) -----------------------

export type Series = { name: string; values: number[]; color?: string };

export function MultiLineChart({ series, labels, formatValue = (v) => v.toLocaleString("fr-FR"), height = 240, className }: {
  series: Series[];
  labels: string[];
  formatValue?: (v: number) => string;
  height?: number;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const n = labels.length;

  const { max, innerH, xFor, yFor } = useMemo(() => {
    const all = series.flatMap((s) => s.values);
    const max = niceMax(Math.max(1, ...all));
    const innerW = VW - PAD.left - PAD.right;
    const innerH = height - PAD.top - PAD.bottom;
    const xFor = (i: number) => (n <= 1 ? PAD.left + innerW / 2 : PAD.left + (i / (n - 1)) * innerW);
    const yFor = (v: number) => PAD.top + innerH - (v / max) * innerH;
    return { max, innerH, xFor, yFor };
  }, [series, labels, height, n]);

  if (n === 0 || series.length === 0) return <EmptyChart height={height} className={className} />;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VW;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(xFor(i) - x); if (d < bestD) { bestD = d; best = i; } }
    setActive(best);
  }

  const color = (s: Series, i: number) => s.color ?? CHART_COLORS[i % CHART_COLORS.length];
  const tipLeft = active != null ? (xFor(active) / VW) * 100 : 0;

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s, i) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: color(s, i) }} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="relative w-full">
        <svg viewBox={`0 0 ${VW} ${height}`} className="w-full" style={{ height }} onMouseMove={onMove} onMouseLeave={() => setActive(null)} role="img">
          <Grid max={max} innerH={innerH} yFor={yFor} fmt={formatValue} />
          {series.map((s, si) => (
            <polyline key={s.name} points={s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ")} fill="none" stroke={color(s, si)} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {active != null && (
            <>
              <line x1={xFor(active)} x2={xFor(active)} y1={PAD.top} y2={height - PAD.bottom} stroke="currentColor" className="text-muted-foreground" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
              {series.map((s, si) => (
                <circle key={s.name} cx={xFor(active)} cy={yFor(s.values[active] ?? 0)} r={4} fill={color(s, si)} stroke="#fff" strokeWidth={1.5} />
              ))}
            </>
          )}
          <g>
            {xTicks(n).map((i) => (
              <text key={i} x={xFor(i)} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">{labels[i]}</text>
            ))}
          </g>
        </svg>
        {active != null && (
          <div className="nm-elevated pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-lg bg-white px-2.5 py-1.5 text-xs" style={{ left: `${Math.min(86, Math.max(14, tipLeft))}%` }}>
            <div className="mb-0.5 font-medium">{labels[active]}</div>
            {series.map((s, si) => (
              <div key={s.name} className="flex items-center gap-1.5 tabular-nums">
                <span className="size-2 rounded-sm" style={{ background: color(s, si) }} />
                <span className="text-muted-foreground">{s.name}</span>
                <span className="ml-auto font-medium">{formatValue(s.values[active] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Donut / camembert -----------------------------------------------------

/** Palette de teintes (vert marque → or → gris) accessibles. */
export const CHART_COLORS = ["#15803d", "#22c55e", "#84cc16", "#d97706", "#0ea5e9", "#8b5cf6", "#64748b"];

/** Graphe en anneau (donut) avec légende et survol. */
export function DonutChart({ data, formatValue = (v) => v.toLocaleString("fr-FR"), size = 200, centerLabel, className, onSlice }: {
  data: ChartPoint[];
  formatValue?: (v: number) => string;
  size?: number;
  centerLabel?: string;
  className?: string;
  /** Rend les parts cliquables (ex. filtrer la table par statut). Reçoit `key`, sinon `label`. */
  onSlice?: (key: string) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const slices = useMemo(() => data.filter((d) => d.value > 0), [data]);
  const total = useMemo(() => slices.reduce((s, d) => s + d.value, 0), [slices]);

  if (slices.length === 0 || total <= 0) {
    return <div className={cn("flex items-center justify-center text-sm text-muted-foreground", className)} style={{ height: size }}>Aucune donnée.</div>;
  }

  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  let acc = 0;

  return (
    <div className={cn("flex flex-wrap items-center gap-6", className)}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }} className="shrink-0">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {slices.map((d, i) => {
            const frac = d.value / total;
            const len = frac * c;
            const dashoffset = -acc * c;
            acc += frac;
            const on = active === i;
            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={on ? 26 : 20}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={dashoffset}
                className="cursor-pointer transition-[stroke-width]"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onClick={onSlice ? () => onSlice(d.key ?? d.label) : undefined}
              />
            );
          })}
        </g>
        <text x={size / 2} y={size / 2 - 4} textAnchor="middle" className="fill-foreground text-[15px] font-semibold">
          {active != null ? formatValue(slices[active].value) : (centerLabel ?? formatValue(total))}
        </text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          {active != null ? slices[active].label : "Total"}
        </text>
      </svg>

      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {slices.map((d, i) => (
          <li
            key={i}
            className={cn("flex items-center gap-2 rounded-md px-1.5 py-0.5", active === i && "bg-accent")}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate">{d.label}</span>
            <span className="tabular-nums font-medium">{formatValue(d.value)}</span>
            <span className="w-10 text-right tabular-nums text-xs text-muted-foreground">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
