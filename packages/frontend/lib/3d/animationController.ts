import * as THREE from 'three';

export type AnimationState = 'idle' | 'paying' | 'working' | 'celebrating';

export interface AnimationConfig {
  crossfadeDuration?: number;
  maxSimultaneousAnimations?: number;
}

export class AnimationController {
  private mixer: THREE.AnimationMixer;
  private animations: Map<string, THREE.AnimationClip>;
  private currentAction: THREE.AnimationAction | null = null;
  private currentState: AnimationState = 'idle';
  private config: Required<AnimationConfig>;

  // Track active animations globally for performance
  private static activeAnimationsCount = 0;
  private static maxSimultaneousAnimations = 3;

  constructor(
    mixer: THREE.AnimationMixer,
    animationClips: THREE.AnimationClip[],
    config: AnimationConfig = {}
  ) {
    this.mixer = mixer;
    this.animations = new Map();
    this.config = {
      crossfadeDuration: config.crossfadeDuration || 0.5,
      maxSimultaneousAnimations: config.maxSimultaneousAnimations || 3,
    };

    AnimationController.maxSimultaneousAnimations =
      this.config.maxSimultaneousAnimations;

    // Store animations by name
    for (const clip of animationClips) {
      this.animations.set(clip.name.toLowerCase(), clip);
    }

    // Start with idle animation if available
    this.playState('idle');
  }

  /**
   * Play animation for a specific state
   */
  public playState(state: AnimationState, force = false): boolean {
    // Don't change if already in this state (unless forced)
    if (this.currentState === state && !force) {
      return false;
    }

    // Limit simultaneous animations for performance
    if (
      AnimationController.activeAnimationsCount >=
      AnimationController.maxSimultaneousAnimations
    ) {
      console.warn('[AnimationController] Max simultaneous animations reached');
      return false;
    }

    const animationName = this.getAnimationNameForState(state);
    const clip = this.animations.get(animationName);

    if (!clip) {
      console.warn(`[AnimationController] Animation "${animationName}" not found`);
      // Fallback to idle
      if (state !== 'idle') {
        return this.playState('idle', force);
      }
      return false;
    }

    const newAction = this.mixer.clipAction(clip);

    if (this.currentAction) {
      // Crossfade to new animation
      this.crossfade(this.currentAction, newAction);
      AnimationController.activeAnimationsCount--;
    } else {
      // Play new animation directly
      newAction.reset();
      newAction.play();
    }

    this.currentAction = newAction;
    this.currentState = state;
    AnimationController.activeAnimationsCount++;

    return true;
  }

  /**
   * Crossfade between two animations
   */
  private crossfade(
    fromAction: THREE.AnimationAction,
    toAction: THREE.AnimationAction
  ): void {
    const duration = this.config.crossfadeDuration;

    toAction.reset();
    toAction.play();
    toAction.setEffectiveTimeScale(1);
    toAction.setEffectiveWeight(1);

    fromAction.crossFadeTo(toAction, duration, true);
  }

  /**
   * Map state to animation name
   */
  private getAnimationNameForState(state: AnimationState): string {
    // This mapping supports both custom models and RobotExpressive
    const mapping: Record<AnimationState, string[]> = {
      idle: ['idle', 'Idle', 'Standing'],
      paying: ['paying', 'Wave', 'ThumbsUp', 'Yes'], // Buyer: wave or nod
      working: ['working', 'Walking', 'Running'], // Seller: typing or working
      celebrating: ['celebrating', 'Dance', 'Jump'], // Both: celebrate or dance
    };

    // Try to find matching animation in order of preference
    const candidates = mapping[state];
    for (const candidate of candidates) {
      const lowerCandidate = candidate.toLowerCase();
      // Check if animation exists (case-insensitive)
      for (const [key] of this.animations) {
        if (key.toLowerCase() === lowerCandidate) {
          return key;
        }
      }
    }

    // Return first candidate as fallback
    return candidates[0];
  }

  /**
   * Update animation mixer (call in render loop)
   */
  public update(delta: number): void {
    this.mixer.update(delta);
  }

  /**
   * Get current animation state
   */
  public getCurrentState(): AnimationState {
    return this.currentState;
  }

  /**
   * Stop all animations
   */
  public stopAll(): void {
    this.mixer.stopAllAction();
    if (this.currentAction) {
      AnimationController.activeAnimationsCount--;
      this.currentAction = null;
    }
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.stopAll();
    this.animations.clear();
  }

  /**
   * Get active animations count (for debugging)
   */
  public static getActiveAnimationsCount(): number {
    return AnimationController.activeAnimationsCount;
  }
}

/**
 * Detect transaction changes and return appropriate animation state
 */
export function detectAnimationState(
  prevData: { total_reviews?: number; avg_rating?: number } | null,
  currentData: { total_reviews?: number; avg_rating?: number },
  agentType: 'buyer' | 'seller'
): AnimationState {
  if (!prevData) {
    return 'idle';
  }

  // Check for new transaction (total_reviews increased)
  if (
    currentData.total_reviews &&
    prevData.total_reviews &&
    currentData.total_reviews > prevData.total_reviews
  ) {
    return agentType === 'buyer' ? 'paying' : 'celebrating';
  }

  // Check for rating change (agent is working)
  if (
    currentData.avg_rating &&
    prevData.avg_rating &&
    currentData.avg_rating !== prevData.avg_rating
  ) {
    return agentType === 'seller' ? 'working' : 'idle';
  }

  return 'idle';
}
