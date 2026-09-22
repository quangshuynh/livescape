import { useMemo } from 'react';

import { mulberry32, range } from './random.js';

interface Building {
  readonly x: number;
  readonly width: number;
  readonly height: number;
  readonly windows: readonly { x: number; y: number; delay: number; lit: boolean }[];
}

function buildSkyline(seed: number, count: number, maxHeight: number): Building[] {
  const random = mulberry32(seed);
  let cursor = -40;
  return range(count).map(() => {
    const width = 40 + random() * 70;
    const height = maxHeight * (0.35 + random() * 0.65);
    const x = cursor;
    cursor += width + 6 + random() * 18;

    const columns = Math.max(1, Math.floor(width / 18));
    const rows = Math.max(1, Math.floor(height / 26));
    const windows = range(columns * rows).map((index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      return {
        x: x + 9 + column * 18,
        y: 540 - height + 16 + row * 26,
        delay: random() * 9,
        lit: random() > 0.38,
      };
    });

    return { x, width, height, windows };
  });
}

export function CityScene() {
  const far = useMemo(() => buildSkyline(20260101, 26, 300), []);
  const near = useMemo(() => buildSkyline(77341, 20, 430), []);

  return (
    <div className="scene scene--city" aria-hidden="true">
      <div className="scene__sky scene__sky--city" />
      <div className="city__glow" />
      <svg className="city__layer city__layer--far" viewBox="0 0 960 540" preserveAspectRatio="xMidYMax slice">
        {far.map((building, index) => (
          <g key={index}>
            <rect
              x={building.x}
              y={540 - building.height}
              width={building.width}
              height={building.height}
              className="city__building city__building--far"
            />
            {building.windows
              .filter((window) => window.lit)
              .map((window, windowIndex) => (
                <rect
                  key={windowIndex}
                  x={window.x}
                  y={window.y}
                  width={5}
                  height={8}
                  className="city__window city__window--far"
                  style={{ animationDelay: `${window.delay}s` }}
                />
              ))}
          </g>
        ))}
      </svg>
      <svg className="city__layer city__layer--near" viewBox="0 0 960 540" preserveAspectRatio="xMidYMax slice">
        {near.map((building, index) => (
          <g key={index}>
            <rect
              x={building.x}
              y={540 - building.height}
              width={building.width}
              height={building.height}
              className="city__building city__building--near"
            />
            {building.windows
              .filter((window) => window.lit)
              .map((window, windowIndex) => (
                <rect
                  key={windowIndex}
                  x={window.x}
                  y={window.y}
                  width={6}
                  height={9}
                  className="city__window"
                  style={{ animationDelay: `${window.delay}s` }}
                />
              ))}
          </g>
        ))}
      </svg>
      <div className="city__street">
        <span className="city__traffic city__traffic--a" />
        <span className="city__traffic city__traffic--b" />
      </div>
    </div>
  );
}
