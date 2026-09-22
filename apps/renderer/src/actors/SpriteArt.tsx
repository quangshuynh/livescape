import type { ReactNode } from 'react';

import { SPRITE_SIZES, type SpriteId } from './sprites.js';

/*
 * Actor artwork. Every drawing here is original to LiveScape, drawn in scene
 * units facing right, with no gradients or ids so any number of copies can be
 * on screen at once. Colour variation comes from the spawner's tint list.
 */

const SKIN = ['#e8b48f', '#c98d63', '#8d5a3b', '#f1c9a5', '#a86f4c'];
const HAIR = ['#2b211c', '#5a3b26', '#1c1a1a', '#8a5a33', '#c9b8a0'];
const TROUSERS = ['#2f3542', '#4a4038', '#3b4a5a', '#5b5147'];

function of<T>(items: readonly T[], variant: number): T {
  return items[Math.abs(variant) % items.length] as T;
}

interface ArtProps {
  readonly tint: string;
  readonly variant: number;
}

function Wheel({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 1.5} fill="#15161a" />
      <circle cx={cx} cy={cy} r={r} fill="#24262c" />
      <circle cx={cx} cy={cy} r={r * 0.46} fill="#a3a8b0" />
      <circle cx={cx} cy={cy} r={r * 0.16} fill="#5b6068" />
    </g>
  );
}

function Shadow({ cx, cy, rx }: { cx: number; cy: number; rx: number }) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={2.6} fill="#000" opacity={0.28} />;
}

const GLASS = '#2b3947';
const GLINT = 'rgba(255, 244, 220, 0.35)';

function Sedan({ tint }: ArtProps) {
  return (
    <>
      <Shadow cx={85} cy={54} rx={82} />
      <path
        d="M8 45 Q3 45 3 38 L5 31 Q7 26 16 25 L44 23 L61 9 Q65 6 72 6 L108 6 Q115 6 119 10 L135 23 L156 26 Q166 28 167 35 L167 42 Q167 46 161 46 Z"
        fill={tint}
      />
      <path d="M3 36 L167 36 L167 42 Q167 46 161 46 L8 46 Q3 46 3 40 Z" fill="#000" opacity={0.18} />
      <path d="M51 23 L64 11 Q67 9 72 9 L86 9 L86 23 Z" fill={GLASS} />
      <path d="M90 9 L107 9 Q112 9 115 12 L128 23 L90 23 Z" fill={GLASS} />
      <path d="M92 11 L102 11 L96 21 L92 21 Z" fill={GLINT} />
      <line x1={88} y1={25} x2={88} y2={44} stroke="#000" strokeOpacity={0.22} strokeWidth={1} />
      <rect x={58} y={29} width={9} height={2} rx={1} fill="#000" opacity={0.3} />
      <rect x={100} y={29} width={9} height={2} rx={1} fill="#000" opacity={0.3} />
      <path d="M160 29 L167 31 L167 35 L160 34 Z" fill="#fff1c2" />
      <rect x={3} y={30} width={5} height={5} rx={1} fill="#c9362b" />
      <circle cx={38} cy={45} r={13} fill="#000" opacity={0.35} />
      <circle cx={132} cy={45} r={13} fill="#000" opacity={0.35} />
      <Wheel cx={38} cy={45} r={10} />
      <Wheel cx={132} cy={45} r={10} />
    </>
  );
}

function Hatchback({ tint }: ArtProps) {
  return (
    <>
      <Shadow cx={70} cy={54} rx={68} />
      <path
        d="M7 45 Q3 45 3 38 L4 18 Q5 9 14 8 L80 7 Q87 7 91 11 L106 24 L128 27 Q137 29 137 36 L137 42 Q137 46 132 46 Z"
        fill={tint}
      />
      <path d="M3 36 L137 36 L137 42 Q137 46 132 46 L7 46 Q3 46 3 40 Z" fill="#000" opacity={0.18} />
      <path d="M11 24 L12 14 Q13 11 17 11 L52 11 L52 24 Z" fill={GLASS} />
      <path d="M56 11 L79 11 Q84 11 87 14 L99 24 L56 24 Z" fill={GLASS} />
      <path d="M60 13 L70 13 L64 22 L60 22 Z" fill={GLINT} />
      <line x1={54} y1={26} x2={54} y2={44} stroke="#000" strokeOpacity={0.22} strokeWidth={1} />
      <path d="M130 30 L137 32 L137 36 L130 35 Z" fill="#fff1c2" />
      <rect x={3} y={22} width={4} height={8} rx={1} fill="#c9362b" />
      <circle cx={30} cy={45} r={12.5} fill="#000" opacity={0.35} />
      <circle cx={110} cy={45} r={12.5} fill="#000" opacity={0.35} />
      <Wheel cx={30} cy={45} r={9.5} />
      <Wheel cx={110} cy={45} r={9.5} />
    </>
  );
}

function Van({ tint }: ArtProps) {
  return (
    <>
      <Shadow cx={92} cy={76} rx={90} />
      <path
        d="M9 64 Q4 64 4 58 L4 12 Q4 5 11 5 L140 5 Q147 5 151 10 L170 34 Q180 37 180 45 L180 60 Q180 64 175 64 Z"
        fill={tint}
      />
      <path d="M4 50 L180 50 L180 60 Q180 64 175 64 L9 64 Q4 64 4 58 Z" fill="#000" opacity={0.2} />
      <path d="M142 12 Q145 11 147 13 L163 34 L142 34 Z" fill={GLASS} />
      <rect x={100} y={12} width={36} height={22} rx={2} fill={GLASS} />
      <path d="M104 14 L114 14 L108 31 L104 31 Z" fill={GLINT} />
      <line x1={96} y1={8} x2={96} y2={62} stroke="#000" strokeOpacity={0.2} strokeWidth={1} />
      <line x1={140} y1={36} x2={140} y2={62} stroke="#000" strokeOpacity={0.2} strokeWidth={1} />
      <rect x={20} y={24} width={60} height={3} rx={1.5} fill="#fff" opacity={0.28} />
      <path d="M173 40 L180 42 L180 47 L173 46 Z" fill="#fff1c2" />
      <rect x={4} y={40} width={5} height={8} rx={1} fill="#c9362b" />
      <circle cx={38} cy={65} r={14} fill="#000" opacity={0.35} />
      <circle cx={146} cy={65} r={14} fill="#000" opacity={0.35} />
      <Wheel cx={38} cy={65} r={11} />
      <Wheel cx={146} cy={65} r={11} />
    </>
  );
}

function Bus({ tint }: ArtProps) {
  const windows: ReactNode[] = [];
  for (let x = 30; x < 330; x += 42) {
    windows.push(<rect key={x} x={x} y={20} width={36} height={32} rx={3} fill={GLASS} />);
    windows.push(<path key={`g${x}`} d={`M${x + 4} 23 L${x + 13} 23 L${x + 6} 48 L${x + 4} 48 Z`} fill={GLINT} />);
  }
  return (
    <>
      <Shadow cx={200} cy={114} rx={196} />
      <rect x={4} y={4} width={392} height={96} rx={10} fill={tint} />
      <rect x={4} y={4} width={392} height={9} rx={4} fill="#fff" opacity={0.18} />
      <rect x={4} y={62} width={392} height={10} fill="#000" opacity={0.16} />
      <path d="M4 80 L396 80 L396 90 Q396 100 386 100 L14 100 Q4 100 4 90 Z" fill="#000" opacity={0.22} />
      {windows}
      <rect x={344} y={20} width={30} height={72} rx={3} fill={GLASS} />
      <line x1={359} y1={22} x2={359} y2={90} stroke="#000" strokeOpacity={0.3} strokeWidth={1.2} />
      <path d="M380 18 L392 18 Q395 18 395 22 L395 58 L380 58 Z" fill={GLASS} />
      <rect x={346} y={8} width={42} height={8} rx={2} fill="#2a2418" />
      <rect x={348} y={10} width={30} height={4} rx={1} fill="#f2b64a" opacity={0.85} />
      <path d="M390 70 L396 71 L396 78 L390 77 Z" fill="#fff1c2" />
      <rect x={4} y={66} width={5} height={10} rx={1} fill="#c9362b" />
      <circle cx={72} cy={101} r={17} fill="#000" opacity={0.4} />
      <circle cx={318} cy={101} r={17} fill="#000" opacity={0.4} />
      <Wheel cx={72} cy={101} r={13} />
      <Wheel cx={318} cy={101} r={13} />
    </>
  );
}

function Cyclist({ tint, variant }: ArtProps) {
  const skin = of(SKIN, variant);
  return (
    <>
      <Shadow cx={31} cy={64} rx={28} />
      <g fill="none" stroke="#1f2126" strokeWidth={2.2}>
        <circle cx={13} cy={52} r={11} />
        <circle cx={49} cy={52} r={11} />
      </g>
      <g fill="none" stroke="#3d4f63" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 52 L25 52 L36 36 L22 36 Z" />
        <path d="M25 52 L20 32" />
        <path d="M36 36 L49 52" />
        <path d="M36 36 L39 28 L44 28" />
      </g>
      <path d="M17 31 L24 31" stroke="#1f2126" strokeWidth={3} strokeLinecap="round" />
      <g stroke={of(TROUSERS, variant)} strokeWidth={4.4} strokeLinecap="round" fill="none">
        <path d="M22 30 L29 41 L25 51" />
        <path d="M22 30 L31 38 L30 46" opacity={0.75} />
      </g>
      <path d="M20 31 Q22 18 33 13 L37 16 Q31 22 27 31 Z" fill={tint} />
      <path d="M33 16 L42 27" stroke={skin} strokeWidth={3} strokeLinecap="round" />
      <circle cx={37} cy={8} r={5.2} fill={skin} />
      <path d="M31.5 7 Q32 1 38 1.5 Q43 2 43 7 Z" fill="#e8e3da" />
    </>
  );
}

function Pedestrian({ tint, variant }: ArtProps) {
  const skin = of(SKIN, variant);
  const hair = of(HAIR, variant + 2);
  const trousers = of(TROUSERS, variant + 1);
  return (
    <>
      <ellipse cx={13} cy={72.5} rx={10} ry={1.8} fill="#000" opacity={0.25} />
      <g className="sprite-walker">
        <g className="sprite-limb sprite-limb--back">
          <rect x={10} y={41} width={5.5} height={31} rx={2.6} fill={trousers} />
          <rect x={9.5} y={69} width={8} height={4} rx={2} fill="#1d1b1a" />
        </g>
        <g className="sprite-limb sprite-limb--front">
          <rect x={10.5} y={41} width={5.5} height={31} rx={2.6} fill={trousers} />
          <rect x={10} y={69} width={8} height={4} rx={2} fill="#26221f" />
        </g>
        <rect x={6} y={16} width={14.5} height={28} rx={6} fill={tint} />
        <g className="sprite-limb sprite-limb--arm">
          <rect x={10.5} y={18} width={5} height={24} rx={2.5} fill={tint} />
          <circle cx={13} cy={42} r={2.4} fill={skin} />
        </g>
        <rect x={11} y={12} width={4.5} height={5} fill={skin} />
        <circle cx={13.5} cy={8} r={6.4} fill={skin} />
        <path d="M7 8 Q7 1 13.5 1.2 Q20 1.4 20.2 7.5 Q17 4.6 13 5 Q9.8 5.6 7 8 Z" fill={hair} />
      </g>
    </>
  );
}

function Bird({ tint }: ArtProps) {
  return (
    <g className="sprite-bird">
      <path
        className="sprite-bird__wings"
        d="M0 3 Q4.5 0 9 5 Q13.5 0 18 3 Q13.5 2.6 9 7.5 Q4.5 2.6 0 3 Z"
        fill={tint}
      />
    </g>
  );
}

function Leaf({ tint }: ArtProps) {
  return (
    <g className="sprite-leaf">
      <path d="M1 6 Q6 -1 16 2 Q17 3 17 6 Q11 13 1 6 Z" fill={tint} />
      <path d="M1 6 Q9 5 17 3.5" stroke="#000" strokeOpacity={0.25} strokeWidth={0.8} fill="none" />
    </g>
  );
}

function Cat({ tint }: ArtProps) {
  return (
    <>
      <ellipse cx={29} cy={33} rx={22} ry={1.6} fill="#000" opacity={0.3} />
      <g className="sprite-walker sprite-walker--cat" fill={tint}>
        <path className="sprite-tail" d="M9 15 Q1 12 2 3 Q3 0 5 2 Q5 9 12 12 Z" />
        <g className="sprite-limb sprite-limb--back">
          <rect x={12} y={20} width={4} height={13} rx={2} />
          <rect x={38} y={20} width={4} height={13} rx={2} />
        </g>
        <g className="sprite-limb sprite-limb--front">
          <rect x={16} y={20} width={4} height={13} rx={2} />
          <rect x={42} y={20} width={4} height={13} rx={2} />
        </g>
        <ellipse cx={28} cy={17} rx={19} ry={8} />
        <circle cx={48} cy={11} r={7} />
        <path d="M43 7 L44 0 L48 5 Z M50 5 L54 0 L54.5 8 Z" />
      </g>
      <circle cx={51.5} cy={10} r={1} fill="#e7d27a" />
    </>
  );
}

const ART: Record<Exclude<SpriteId, 'light-streak'>, (props: ArtProps) => ReactNode> = {
  sedan: Sedan,
  hatchback: Hatchback,
  van: Van,
  bus: Bus,
  cyclist: Cyclist,
  pedestrian: Pedestrian,
  bird: Bird,
  leaf: Leaf,
  cat: Cat,
};

const DEFAULT_TINT = '#8a8f98';

export interface SpriteArtProps {
  readonly sprite: SpriteId;
  readonly tint: string | null;
  /** Picks secondary colours (skin, hair) deterministically. */
  readonly variant: number;
}

export function SpriteArt({ sprite, tint, variant }: SpriteArtProps) {
  const colour = tint ?? DEFAULT_TINT;
  if (sprite === 'light-streak') {
    return (
      <span
        className="sprite-streak"
        style={{ background: `linear-gradient(90deg, transparent, ${colour}, transparent)` }}
      />
    );
  }
  const { width, height } = SPRITE_SIZES[sprite];
  const Art = ART[sprite];
  return (
    <svg
      className={`sprite sprite--${sprite}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      overflow="visible"
    >
      <Art tint={colour} variant={variant} />
    </svg>
  );
}
