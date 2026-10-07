/**
 * Shared scene boundary for the sky, wires and normalized input adapters.
 *
 * Scene methods:
 *   sync(items, changes = [])       Reconcile canonical items by itemId.
 *   update(dtMs, simTime)           Advance motion; both values are milliseconds.
 *   getFrame()                     Return the SAME reusable frame object.
 *   setEnvironment(environment)    Receive ambience, never create item birds.
 *   resize({ width, height })      Update CSS-pixel bounds.
 *   dispose()                      Release resources owned by this strategy.
 *
 * Frames contain { birds, geometry, width, height, time }. Strategies reuse
 * their bird objects and arrays. A birdId is exactly the input item's itemId,
 * independent of its array slot, position or current scene.
 *
 * Renderer birds use projected CSS pixels:
 * { birdId, x, y, size, heading, wingPhase, bank, pose, readState, activity }.
 * size is body length; heading and wingPhase are radians; bank is -1..1;
 * activity and optional poseProgress are 0..1. In the perched pose, x/y is the
 * feet contact point; in every flight pose, x/y is the body centre. Optional
 * facing is +1 (right) or -1 (left) for perched birds. readState is read,
 * unread or unknown. Geometry belongs to the scene (for example, wire paths).
 *
 * The host owns RAF, fixed updates, visibility, pause and external item state.
 * A renderer does not advance time or mutate a scene or its input items.
 */

export const BIRD_POSES = Object.freeze(['flying', 'gliding', 'landing', 'perched', 'takeoff']);

export function createSceneFrame(width = 1, height = 1) {
  return { birds: [], geometry: [], width, height, time: 0 };
}

export function sceneBirdId(item) {
  const id = item?.itemId ?? item?.birdId;
  if (typeof id !== 'string' || !id.trim()) {
    throw new TypeError('Every scene item needs a stable, nonempty itemId.');
  }
  return id;
}

// Variation is tied to identity. It must not consume the flock engine's random
// sequence, or changing bird appearance would change its seeded trajectories.
export function birdVariation(birdId) {
  let hash = 2166136261;
  for (let i = 0; i < birdId.length; i++) hash = Math.imul(hash ^ birdId.charCodeAt(i), 16777619);
  const unit = (shift) => ((hash >>> shift) & 255) / 255;
  return {
    phase: unit(0) * Math.PI * 2,
    frequency: 2.4 + unit(8) * 1.4,
    scale: 0.84 + unit(16) * 0.3,
    glideOffset: unit(24) * 17,
  };
}
