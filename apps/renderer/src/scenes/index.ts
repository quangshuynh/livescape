import type { ComponentType } from 'react';
import type { SceneId } from '@livescape/protocol';

import { CityScene } from './CityScene.js';
import { ForestScene } from './ForestScene.js';
import { SpaceScene } from './SpaceScene.js';

/** Scene ids resolve only through this map -- nothing else can be rendered. */
export const SCENE_COMPONENTS: Record<SceneId, ComponentType> = {
  city: CityScene,
  forest: ForestScene,
  space: SpaceScene,
};
