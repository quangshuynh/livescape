import { EFFECT_IDS } from '@livescape/protocol';
import { describe, expect, it } from 'vitest';

import { SCENE_LAYERS } from '../actors/types.js';
import { EFFECT_PLANE, effectPlaneZIndex, scenePlaneZIndex, stageZIndex } from './layers.js';

describe('stage order', () => {
  it('composes the scene around the subject, back to front', () => {
    const subject = stageZIndex('subject');

    expect(scenePlaneZIndex('backdrop')).toBeLessThan(scenePlaneZIndex('environment'));
    expect(scenePlaneZIndex('environment')).toBeLessThan(effectPlaneZIndex('background'));
    expect(effectPlaneZIndex('background')).toBeLessThan(subject);
    expect(subject).toBeLessThan(scenePlaneZIndex('foreground'));
    expect(scenePlaneZIndex('foreground')).toBeLessThan(effectPlaneZIndex('foreground'));
    expect(effectPlaneZIndex('foreground')).toBeLessThan(stageZIndex('debug'));
    expect(stageZIndex('debug')).toBeLessThan(stageZIndex('setup'));
  });

  it('puts exactly one scene plane in front of the subject', () => {
    const inFront = SCENE_LAYERS.filter((layer) => scenePlaneZIndex(layer) > stageZIndex('subject'));
    expect(inFront).toEqual(['foreground']);
  });

  it('assigns every effect to exactly one plane: weather in front, fireworks behind', () => {
    expect(Object.keys(EFFECT_PLANE).sort()).toEqual([...EFFECT_IDS].sort());
    expect(EFFECT_PLANE).toEqual({ rain: 'foreground', snow: 'foreground', fireworks: 'background' });
  });
});
