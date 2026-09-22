import { useState, type CSSProperties, type ReactNode } from 'react';

/*
 * Roadside Workshop: the view from inside an open workshop, out through the
 * roll-up door to a street at golden hour. All artwork is original to
 * LiveScape and drawn inline; nothing is fetched.
 *
 * Composition, back to front, in the shared 960x540 scene space:
 *
 * * backdrop: sky, the row of shops across the street, the road and the near
 *   sidewalk. Traffic and pedestrians are actors on this plane, so they are
 *   only ever seen through the doorway.
 * * environment: the workshop itself, with the door opening at x 190-770,
 *   y 86-420. The cat is an actor on this plane, in front of the walls and
 *   behind the subject.
 * * foreground: the bench corner, a toolbox and a hanging plant at the frame
 *   edges, plus blown leaves as actors, all in front of the subject.
 */

const VIEW_BOX = '0 0 960 540';
const OPENING = { left: 190, right: 770, top: 86, floor: 420 };

function Building({
  x,
  width,
  top,
  fill,
  children,
}: {
  x: number;
  width: number;
  top: number;
  fill: string;
  children?: ReactNode;
}) {
  return (
    <g>
      <rect x={x} y={top} width={width} height={298 - top} fill={fill} />
      <rect x={x} y={top} width={width} height={6} fill="#000" opacity={0.12} />
      {children}
    </g>
  );
}

function Windows({
  x,
  y,
  columns,
  rows,
  lit,
}: {
  x: number;
  y: number;
  columns: number;
  rows: number;
  lit: readonly number[];
}) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      cells.push(
        <rect
          key={index}
          x={x + column * 26}
          y={y + row * 34}
          width={16}
          height={22}
          rx={1.5}
          fill={lit.includes(index) ? '#f6c77b' : '#4b3d37'}
          opacity={lit.includes(index) ? 0.92 : 0.85}
        />,
      );
    }
  }
  return <>{cells}</>;
}

function Awning({ x, width, y, stripe, base }: { x: number; width: number; y: number; stripe: string; base: string }) {
  const stripes = [];
  for (let offset = 0; offset < width; offset += 16) {
    stripes.push(<rect key={offset} x={x + offset} y={y} width={8} height={16} fill={stripe} />);
  }
  return (
    <g>
      <rect x={x} y={y} width={width} height={16} fill={base} />
      {stripes}
      <rect x={x} y={y + 16} width={width} height={4} fill="#000" opacity={0.18} />
    </g>
  );
}

/** The far world, seen through the workshop door. */
export function RoadsideBackdrop() {
  return (
    <div className="scene scene--roadside" aria-hidden="true">
      <svg className="roadside__art" viewBox={VIEW_BOX} preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="rw-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7d9bbd" />
            <stop offset="0.42" stopColor="#e6b891" />
            <stop offset="0.72" stopColor="#f5d4a2" />
            <stop offset="1" stopColor="#f8e3bd" />
          </linearGradient>
          <radialGradient id="rw-sun">
            <stop offset="0" stopColor="#fff4d4" stopOpacity="0.95" />
            <stop offset="0.35" stopColor="#ffe2a8" stopOpacity="0.45" />
            <stop offset="1" stopColor="#ffd08a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="rw-road" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7a6f70" />
            <stop offset="1" stopColor="#4c4950" />
          </linearGradient>
        </defs>

        <rect width="960" height="540" fill="url(#rw-sky)" />
        <circle cx="300" cy="228" r="170" fill="url(#rw-sun)" />
        <circle cx="300" cy="236" r="20" fill="#fff6dc" />

        <g className="roadside__cloud roadside__cloud--a" fill="#fbe8d0" opacity="0.8">
          <ellipse cx="560" cy="126" rx="62" ry="11" />
          <ellipse cx="588" cy="117" rx="34" ry="13" />
          <ellipse cx="534" cy="121" rx="28" ry="9" />
        </g>
        <g className="roadside__cloud roadside__cloud--b" fill="#fbe3c6" opacity="0.6">
          <ellipse cx="360" cy="164" rx="44" ry="7" />
          <ellipse cx="378" cy="158" rx="22" ry="9" />
        </g>

        {/* Hazy far skyline. */}
        <path
          d="M0 262 L40 262 L40 238 L78 238 L78 250 L120 250 L120 226 L150 226 L150 254 L210 254 L210 240 L260 240 L260 258 L330 258 L330 232 L360 232 L360 250 L430 250 L430 236 L470 236 L470 256 L540 256 L540 228 L566 228 L566 246 L640 246 L640 238 L700 238 L700 254 L780 254 L780 230 L812 230 L812 248 L880 248 L880 240 L960 240 L960 300 L0 300 Z"
          fill="#c89f8a"
          opacity="0.55"
        />

        {/* Across the street. */}
        <Building x={0} width={112} top={170} fill="#a8866f">
          <Windows x={18} y={190} columns={3} rows={2} lit={[1, 5]} />
        </Building>
        <Building x={112} width={122} top={146} fill="#9a7868">
          <Windows x={128} y={166} columns={4} rows={3} lit={[0, 6, 7]} />
        </Building>
        <Building x={234} width={170} top={190} fill="#e0c19a">
          <rect x="234" y="190" width="170" height="8" fill="#c7a47b" />
          <Windows x={252} y={204} columns={6} rows={1} lit={[2, 3]} />
          <rect x="250" y="252" width="84" height="42" rx="2" fill="#3f3837" />
          <rect x="254" y="258" width="76" height="34" fill="#f2b76a" opacity="0.42" />
          <rect x="346" y="248" width="30" height="50" rx="2" fill="#5b4236" />
          <Awning x={242} width={154} y={230} stripe="#f2e2c5" base="#b6503b" />
        </Building>
        <Building x={404} width={156} top={140} fill="#7f9793">
          <Windows x={422} y={158} columns={5} rows={2} lit={[1, 4, 8]} />
          <rect x="420" y="220" width="124" height="18" rx="2" fill="#dbcfb3" />
          <rect x="420" y="248" width="80" height="46" rx="2" fill="#35403f" />
          <rect x="424" y="252" width="72" height="38" fill="#a7c4c0" opacity="0.25" />
          <rect x="512" y="246" width="30" height="52" rx="2" fill="#4e5b59" />
        </Building>
        <g className="roadside__tree">
          <rect x="596" y="238" width="8" height="62" fill="#5a4332" />
          <circle cx="576" cy="232" r="26" fill="#5c7644" />
          <circle cx="626" cy="228" r="28" fill="#5c7644" />
          <circle cx="600" cy="212" r="38" fill="#6d8a51" />
          <circle cx="588" cy="200" r="16" fill="#8aa564" opacity="0.6" />
        </g>
        <Building x={640} width={162} top={176} fill="#b56a4f">
          <Windows x={658} y={192} columns={5} rows={1} lit={[0, 3]} />
          <rect x="656" y="250" width="100" height="44" rx="2" fill="#3a302d" />
          <rect x="660" y="254" width="92" height="36" fill="#f4c27a" opacity="0.35" />
          <rect x="764" y="246" width="28" height="52" rx="2" fill="#5a3a2c" />
          <Awning x={650} width={112} y={232} stripe="#e9e0cb" base="#4f7a5c" />
        </Building>
        <Building x={802} width={158} top={214} fill="#8e8c86">
          <rect x="820" y="232" width="120" height="58" fill="#6d6b66" />
          <g stroke="#5b5955" strokeWidth="2">
            <line x1="820" y1="244" x2="940" y2="244" />
            <line x1="820" y1="258" x2="940" y2="258" />
            <line x1="820" y1="272" x2="940" y2="272" />
          </g>
        </Building>

        {/* Utility pole, wires and a street lamp. */}
        <g fill="none" stroke="#3e3431" strokeWidth="1.2" opacity="0.8">
          <path d="M0 108 Q360 150 704 94" />
          <path d="M0 118 Q360 160 704 104" />
          <path d="M704 94 Q830 122 960 102" />
          <path d="M704 104 Q830 132 960 112" />
        </g>
        <rect x="700" y="70" width="8" height="230" fill="#5a4638" />
        <rect x="684" y="90" width="40" height="5" fill="#5a4638" />
        <rect x="468" y="206" width="4" height="94" fill="#3b3a3f" />
        <path d="M470 208 Q474 200 492 202 L492 206 Q476 205 472 212 Z" fill="#3b3a3f" />
        <rect x="486" y="204" width="14" height="5" rx="2" fill="#3b3a3f" />

        {/* Street. */}
        <rect x="0" y="298" width="960" height="15" fill="#cdb89b" />
        <rect x="0" y="313" width="960" height="3" fill="#9a8772" />
        <rect x="0" y="316" width="960" height="72" fill="url(#rw-road)" />
        <line
          x1="0"
          y1="351"
          x2="960"
          y2="351"
          stroke="#e8cf8a"
          strokeWidth="2.5"
          strokeDasharray="28 24"
          opacity="0.75"
        />
        <rect x="0" y="388" width="960" height="3" fill="#9a8772" />
        <rect x="0" y="391" width="960" height="14" fill="#d3c0a4" />
        <g stroke="#b3a086" strokeWidth="1">
          <line x1="120" y1="391" x2="116" y2="405" />
          <line x1="300" y1="391" x2="298" y2="405" />
          <line x1="480" y1="391" x2="480" y2="405" />
          <line x1="660" y1="391" x2="662" y2="405" />
          <line x1="840" y1="391" x2="844" y2="405" />
        </g>
        <rect x="0" y="405" width="960" height="20" fill="#b9a78d" />
      </svg>
    </div>
  );
}

function PegboardTools() {
  return (
    <g>
      {/* Wrench */}
      <g fill="#aeb3b8">
        <rect x="70" y="196" width="6" height="52" rx="3" />
        <circle cx="73" cy="196" r="8" />
        <circle cx="73" cy="248" r="6" />
      </g>
      <circle cx="73" cy="192" r="3.5" fill="#b08d62" />
      {/* Hammer */}
      <rect x="96" y="202" width="6" height="50" rx="2" fill="#8a5a36" />
      <rect x="86" y="194" width="26" height="10" rx="2" fill="#5e6368" />
      {/* Screwdrivers */}
      <rect x="124" y="194" width="7" height="20" rx="3" fill="#c0392b" />
      <rect x="126.5" y="214" width="2" height="26" fill="#9ea3a8" />
      <rect x="138" y="194" width="7" height="20" rx="3" fill="#d4a017" />
      <rect x="140.5" y="214" width="2" height="22" fill="#9ea3a8" />
      {/* Saw */}
      <path d="M86 272 L150 272 L150 284 L94 298 Z" fill="#b7bcc1" />
      <rect x="148" y="266" width="16" height="22" rx="4" fill="#7b4a2c" />
      {/* Tape measure */}
      <circle cx="156" cy="226" r="9" fill="#e0b52f" />
      <circle cx="156" cy="226" r="3.5" fill="#6b5a2a" />
    </g>
  );
}

/**
 * Each hand is set to its mount-time angle and turns from there. Under
 * reduced motion only the turning stops, so the clock still shows the time.
 */
function ClockHand({ seconds, period, children }: { seconds: number; period: number; children: ReactNode }) {
  const style: CSSProperties = { animationDuration: `${period}s` };
  return (
    <g transform={`rotate(${((seconds % period) / period) * 360} 850 128)`}>
      <g className="roadside__hand" style={style}>
        {children}
      </g>
    </g>
  );
}

function WallClock() {
  // Set to the local time when the scene is shown; it keeps time from there
  // without any timer or re-render.
  const [seconds] = useState(() => {
    const now = new Date();
    return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  });
  return (
    <g>
      <circle cx="850" cy="128" r="22" fill="#efe5cf" stroke="#3a302a" strokeWidth="3.5" />
      {[0, 90, 180, 270].map((angle) => (
        <rect
          key={angle}
          x="849"
          y="109"
          width="2"
          height="5"
          fill="#3a302a"
          transform={`rotate(${angle} 850 128)`}
        />
      ))}
      <ClockHand seconds={seconds} period={43200}>
        <rect x="848.5" y="116" width="3" height="13" rx="1.5" fill="#2b2420" />
      </ClockHand>
      <ClockHand seconds={seconds} period={3600}>
        <rect x="849" y="111" width="2" height="18" rx="1" fill="#2b2420" />
      </ClockHand>
      <ClockHand seconds={seconds} period={60}>
        <rect x="849.6" y="110" width="0.8" height="21" fill="#b3372c" />
      </ClockHand>
      <circle cx="850" cy="128" r="2" fill="#2b2420" />
    </g>
  );
}

/** The workshop around the subject: walls, the open door, floor and fittings. */
export function RoadsideEnvironment() {
  const { left, right, top, floor } = OPENING;
  return (
    <div className="scene scene--roadside" aria-hidden="true">
      <svg className="roadside__art" viewBox={VIEW_BOX} preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="rw-wall" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="960" y2="0">
            <stop offset="0" stopColor="#362d28" />
            <stop offset="0.2" stopColor="#524439" />
            <stop offset="0.8" stopColor="#524439" />
            <stop offset="1" stopColor="#362d28" />
          </linearGradient>
          <linearGradient id="rw-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8f8373" />
            <stop offset="0.5" stopColor="#5f564d" />
            <stop offset="1" stopColor="#3a332e" />
          </linearGradient>
          <radialGradient id="rw-lamp">
            <stop offset="0" stopColor="#ffd98f" stopOpacity="0.5" />
            <stop offset="1" stopColor="#ffc970" stopOpacity="0" />
          </radialGradient>
          <pattern id="rw-peg" width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="5" cy="5" r="1.1" fill="#6d5337" />
          </pattern>
        </defs>

        {/* Ceiling, side walls, and the front wall with the door cut out. */}
        <path d="M0 0 H960 L920 16 H40 Z" fill="#2c2522" />
        <path d="M0 0 L40 16 V420 L0 444 Z" fill="#332a25" />
        <path d="M960 0 L920 16 V420 L960 444 Z" fill="#332a25" />
        <path
          d={`M40 16 H920 V${floor} H40 Z M${left} ${top} V${floor} H${right} V${top} Z`}
          fill="url(#rw-wall)"
          fillRule="evenodd"
        />

        {/* Door frame, the rolled-up door and its tracks. */}
        <rect x={left - 10} y={top - 8} width={right - left + 20} height="8" fill="#6d5a4a" />
        <rect x={left - 10} y={top} width="10" height={floor - top} fill="#6d5a4a" />
        <rect x={right} y={top} width="10" height={floor - top} fill="#6d5a4a" />
        <rect x={left} y={top} width={right - left} height="18" fill="#8d9196" />
        <g stroke="#6b6f74" strokeWidth="1.4">
          <line x1={left} y1={top + 5} x2={right} y2={top + 5} />
          <line x1={left} y1={top + 10} x2={right} y2={top + 10} />
          <line x1={left} y1={top + 15} x2={right} y2={top + 15} />
        </g>
        <rect x={left} y={top + 18} width={right - left} height="4" fill="#000" opacity="0.25" />
        <rect x={left} y={top + 18} width="6" height={floor - top - 18} fill="#767a80" />
        <rect x={right - 6} y={top + 18} width="6" height={floor - top - 18} fill="#767a80" />

        {/* Floor, with the evening light spilling in through the door. */}
        <path d="M0 444 L40 420 H920 L960 444 V540 H0 Z" fill="url(#rw-floor)" />
        <path d={`M${left} ${floor} H${right} L850 540 H110 Z`} fill="#ffd9a0" opacity="0.1" />
        <rect x={left} y={floor} width={right - left} height="3" fill="#b3a58f" opacity="0.8" />
        <g stroke="#000" strokeOpacity="0.14" strokeWidth="1.2">
          <line x1="330" y1={floor} x2="221" y2="540" />
          <line x1="630" y1={floor} x2="739" y2="540" />
          <line x1="20" y1="470" x2="940" y2="470" />
        </g>
        <ellipse cx="610" cy="498" rx="54" ry="8" fill="#1f1b19" opacity="0.28" />

        {/* Left wall: neon sign, pegboard, a low bench. */}
        <g className="roadside__neon">
          <rect x="62" y="108" width="100" height="38" rx="9" fill="#2a1d22" stroke="#ff6f92" strokeWidth="3" />
          <text
            x="112"
            y="135"
            textAnchor="middle"
            fontFamily="'Segoe UI', system-ui, sans-serif"
            fontWeight="700"
            fontSize="22"
            letterSpacing="3"
            fill="#ffd3de"
          >
            OPEN
          </text>
        </g>
        <rect x="52" y="178" width="122" height="136" fill="#b08d62" />
        <rect x="52" y="178" width="122" height="136" fill="url(#rw-peg)" />
        <PegboardTools />
        <rect x="44" y="340" width="138" height="10" fill="#7a5236" />
        <rect x="52" y="350" width="7" height="70" fill="#5c3d28" />
        <rect x="166" y="350" width="7" height="70" fill="#5c3d28" />
        <rect x="70" y="316" width="60" height="24" rx="3" fill="#2f5d7c" />
        <rect x="92" y="310" width="16" height="6" rx="2" fill="#a0a6ab" />
        <rect x="140" y="326" width="14" height="14" rx="2" fill="#c8553d" />

        {/* Right wall: clock, shelves, a stack of tyres. */}
        <WallClock />
        <rect x="788" y="200" width="126" height="6" fill="#7a5236" />
        <rect x="796" y="176" width="22" height="24" rx="2" fill="#3d6e8f" />
        <rect x="796" y="174" width="22" height="4" rx="1" fill="#9aa3aa" />
        <rect x="824" y="180" width="20" height="20" rx="2" fill="#c8553d" />
        <rect x="850" y="168" width="34" height="32" fill="#b38b5d" />
        <rect x="850" y="180" width="34" height="3" fill="#8f6d45" />
        <rect x="888" y="184" width="18" height="16" rx="2" fill="#e0b84c" />
        <rect x="788" y="262" width="126" height="6" fill="#7a5236" />
        <rect x="798" y="236" width="10" height="26" rx="3" fill="#6d8f5a" />
        <rect x="812" y="240" width="10" height="22" rx="3" fill="#d6d0c2" />
        <rect x="830" y="244" width="30" height="18" rx="2" fill="#4a4f55" />
        <circle cx="886" cy="250" r="12" fill="none" stroke="#e08a2e" strokeWidth="4" />
        <g fill="#232428">
          <rect x="804" y="396" width="96" height="24" rx="11" />
          <rect x="806" y="371" width="92" height="24" rx="11" />
          <rect x="804" y="346" width="96" height="24" rx="11" />
        </g>
        <g stroke="#3a3b40" strokeWidth="1.5">
          <line x1="816" y1="358" x2="888" y2="358" />
          <line x1="818" y1="383" x2="886" y2="383" />
          <line x1="816" y1="408" x2="888" y2="408" />
        </g>

        {/* Pendant lamp over the left of the door. */}
        <g className="roadside__lamp">
          <circle cx="252" cy="150" r="110" fill="url(#rw-lamp)" />
          <line x1="252" y1="0" x2="252" y2="112" stroke="#1d1a18" strokeWidth="2" />
          <path d="M236 112 H268 L278 132 H226 Z" fill="#2f3b36" />
          <ellipse cx="252" cy="133" rx="11" ry="4" fill="#fff0c4" />
        </g>
      </svg>
    </div>
  );
}

/** Props at the frame edges, drawn in front of the subject. */
export function RoadsideForeground() {
  return (
    <div className="scene scene--roadside" aria-hidden="true">
      <svg className="roadside__art" viewBox={VIEW_BOX} preserveAspectRatio="xMidYMax slice">
        {/* Bench corner, bottom left. */}
        <path d="M0 466 L198 482 L216 540 H0 Z" fill="#8f6240" />
        <path d="M198 482 L216 540 H228 L210 480 Z" fill="#5e3f29" />
        <path d="M0 466 L198 482" stroke="#c08a5a" strokeWidth="3" />
        <g stroke="#6f4a2f" strokeOpacity="0.5" strokeWidth="1">
          <path d="M0 492 L150 504" />
          <path d="M0 516 L170 526" />
        </g>
        {/* Bench vise. */}
        <g>
          <rect x="134" y="472" width="56" height="8" rx="2" fill="#4b5157" />
          <path d="M142 472 L146 452 H172 L176 472 Z" fill="#5f666d" />
          <rect x="136" y="440" width="20" height="16" rx="2" fill="#737b83" />
          <rect x="160" y="440" width="20" height="16" rx="2" fill="#737b83" />
          <rect x="136" y="440" width="44" height="3" fill="#9aa1a8" />
          <rect x="178" y="446" width="26" height="4" rx="2" fill="#9aa1a8" />
          <circle cx="205" cy="448" r="3.5" fill="#9aa1a8" />
        </g>
        <g>
          <path className="roadside__steam" d="M80 446 Q74 436 82 428 Q88 420 82 410" />
          <path className="roadside__steam roadside__steam--late" d="M90 446 Q96 436 88 426 Q82 418 90 408" />
          <rect x="68" y="448" width="32" height="38" rx="5" fill="#dfe6e6" />
          <path d="M100 456 Q112 458 111 468 Q110 478 100 477" fill="none" stroke="#dfe6e6" strokeWidth="5" />
          <ellipse cx="84" cy="449" rx="15" ry="3.5" fill="#4b2e1f" />
          <rect x="68" y="470" width="32" height="16" rx="5" fill="#000" opacity="0.08" />
        </g>
        <g fill="#8d9399">
          <polygon points="36,496 42,493 48,496 48,502 42,505 36,502" />
          <polygon points="118,506 123,503 128,506 128,511 123,514 118,511" />
        </g>

        {/* Rolling toolbox, bottom right. */}
        <rect x="786" y="468" width="190" height="90" rx="6" fill="#a8322b" />
        <rect x="786" y="468" width="190" height="7" rx="3" fill="#c9463c" />
        <g stroke="#7b2420" strokeWidth="2">
          <line x1="786" y1="500" x2="960" y2="500" />
          <line x1="786" y1="526" x2="960" y2="526" />
        </g>
        <rect x="846" y="484" width="60" height="5" rx="2.5" fill="#cfd3d6" />
        <rect x="846" y="510" width="60" height="5" rx="2.5" fill="#cfd3d6" />
        <g fill="#b9bec3">
          <rect x="812" y="458" width="56" height="6" rx="3" transform="rotate(-6 840 461)" />
          <circle cx="812" cy="463" r="7" />
        </g>

        {/* Hanging plant, top right. */}
        <g className="roadside__vines">
          <line x1="890" y1="-20" x2="900" y2="10" stroke="#3b3029" strokeWidth="1.5" />
          <line x1="930" y1="-20" x2="920" y2="10" stroke="#3b3029" strokeWidth="1.5" />
          <g fill="none" stroke="#3f6b3a" strokeWidth="2">
            <path d="M890 36 Q880 80 892 120 Q900 150 888 176" />
            <path d="M912 38 Q920 90 908 132" />
            <path d="M932 34 Q946 70 938 104 Q932 128 944 150" />
          </g>
          <g fill="#5b8c4a">
            <ellipse cx="884" cy="70" rx="7" ry="4.5" transform="rotate(-30 884 70)" />
            <ellipse cx="894" cy="104" rx="7" ry="4.5" transform="rotate(25 894 104)" />
            <ellipse cx="890" cy="144" rx="7" ry="4.5" transform="rotate(-20 890 144)" />
            <ellipse cx="886" cy="172" rx="6" ry="4" transform="rotate(30 886 172)" />
            <ellipse cx="916" cy="80" rx="7" ry="4.5" transform="rotate(30 916 80)" />
            <ellipse cx="910" cy="124" rx="6" ry="4" transform="rotate(-25 910 124)" />
            <ellipse cx="942" cy="64" rx="7" ry="4.5" transform="rotate(-35 942 64)" />
            <ellipse cx="938" cy="100" rx="7" ry="4.5" transform="rotate(20 938 100)" />
            <ellipse cx="942" cy="146" rx="6" ry="4" transform="rotate(-20 942 146)" />
          </g>
          <path d="M880 6 H944 L936 40 H888 Z" fill="#b8643f" />
          <rect x="876" y="2" width="72" height="9" rx="3" fill="#c97a52" />
        </g>
      </svg>
    </div>
  );
}
