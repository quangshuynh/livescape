import { useMemo } from 'react';

import { mulberry32, range } from './random.js';

interface Star {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly delay: number;
  readonly duration: number;
}

function buildStars(seed: number, count: number): Star[] {
  const random = mulberry32(seed);
  return range(count).map(() => ({
    x: random() * 960,
    y: random() * 540,
    radius: 0.4 + random() * 1.5,
    delay: random() * 6,
    duration: 3 + random() * 5,
  }));
}

export function SpaceScene() {
  const stars = useMemo(() => buildStars(31337, 320), []);
  const brightStars = useMemo(() => buildStars(8125, 14), []);

  return (
    <div className="scene scene--space" aria-hidden="true">
      <div className="scene__sky scene__sky--space" />
      <div className="space__nebula space__nebula--violet" />
      <div className="space__nebula space__nebula--cyan" />
      <svg className="space__stars" viewBox="0 0 960 540" preserveAspectRatio="xMidYMid slice">
        {stars.map((star, index) => (
          <circle
            key={index}
            cx={star.x}
            cy={star.y}
            r={star.radius}
            className="space__star"
            style={{ animationDelay: `${star.delay}s`, animationDuration: `${star.duration}s` }}
          />
        ))}
        {brightStars.map((star, index) => (
          <circle
            key={`bright-${index}`}
            cx={star.x}
            cy={star.y}
            r={star.radius + 1.1}
            className="space__star space__star--bright"
            style={{ animationDelay: `${star.delay}s`, animationDuration: `${star.duration + 2}s` }}
          />
        ))}
      </svg>
      <div className="space__planet" />
    </div>
  );
}
