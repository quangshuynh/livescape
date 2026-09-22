import { useMemo } from 'react';

import { mulberry32, range } from './random.js';

interface Tree {
  readonly x: number;
  readonly height: number;
  readonly width: number;
}

function buildTreeline(seed: number, count: number, baseHeight: number): Tree[] {
  const random = mulberry32(seed);
  return range(count).map((index) => {
    const height = baseHeight * (0.72 + random() * 0.5);
    return {
      x: (index / count) * 1060 - 50 + random() * 26,
      height,
      // Conifers read as triangles, not spikes: width tracks height.
      width: height * (0.3 + random() * 0.14),
    };
  });
}

const TIERS = 3;

/**
 * A conifer drawn as stacked triangles: each tier sits a little higher and a
 * little narrower than the one below it.
 */
function tierPath(tree: Tree, tier: number): string {
  const base = 540;
  const tierBottom = base - tree.height * (tier * 0.26);
  const tierTop = base - tree.height * (0.45 + tier * 0.275);
  const halfWidth = (tree.width / 2) * (1 - tier * 0.24);
  return `M ${tree.x - halfWidth} ${tierBottom} L ${tree.x} ${tierTop} L ${tree.x + halfWidth} ${tierBottom} Z`;
}

function Treeline({ trees, className }: { trees: readonly Tree[]; className: string }) {
  return (
    <>
      {trees.map((tree, index) => (
        <g key={index}>
          <rect
            x={tree.x - tree.width * 0.045}
            y={540 - tree.height * 0.22}
            width={tree.width * 0.09}
            height={tree.height * 0.22}
            className={className}
          />
          {range(TIERS).map((tier) => (
            <path key={tier} d={tierPath(tree, tier)} className={className} />
          ))}
        </g>
      ))}
    </>
  );
}

export function ForestScene() {
  const far = useMemo(() => buildTreeline(4212, 26, 170), []);
  const mid = useMemo(() => buildTreeline(9931, 19, 250), []);
  const near = useMemo(() => buildTreeline(1571, 13, 360), []);

  return (
    <div className="scene scene--forest" aria-hidden="true">
      <div className="scene__sky scene__sky--forest" />
      <div className="forest__sun" />
      <div className="forest__shafts">
        <span className="forest__shaft forest__shaft--a" />
        <span className="forest__shaft forest__shaft--b" />
        <span className="forest__shaft forest__shaft--c" />
      </div>
      <svg className="forest__layer forest__layer--far" viewBox="0 0 960 540" preserveAspectRatio="xMidYMax slice">
        <Treeline trees={far} className="forest__tree forest__tree--far" />
      </svg>
      <div className="forest__mist" />
      <svg className="forest__layer forest__layer--mid" viewBox="0 0 960 540" preserveAspectRatio="xMidYMax slice">
        <Treeline trees={mid} className="forest__tree forest__tree--mid" />
      </svg>
      <svg className="forest__layer forest__layer--near" viewBox="0 0 960 540" preserveAspectRatio="xMidYMax slice">
        <Treeline trees={near} className="forest__tree forest__tree--near" />
      </svg>
      <div className="forest__floor" />
    </div>
  );
}
