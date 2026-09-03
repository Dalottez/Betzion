import { Injectable } from '@angular/core';

/**
 * High-definition audio service for Aviator game.
 * Uses dedicated audio instances and strict playback mutex to eliminate echo/duplicate playback.
 */
@Injectable({ providedIn: 'root' })
export class GameSoundService {
  private unlocked = false;
  private enabled = localStorage.getItem('aviator_sound_enabled') !== 'false';
  private isTabVisible = typeof document !== 'undefined' ? !document.hidden : true;

  private bgAudio: HTMLAudioElement | null = null;
  private crashAudio: HTMLAudioElement | null = null;
  private isBgPlaying = false;

  constructor() {
    this.initAudioElements();
    this.initVisibilityListeners();
  }

  private initAudioElements(): void {
    if (typeof window === 'undefined') return;

    this.bgAudio = new Audio('/assets/audio/flying.mp3.mpeg');
    this.bgAudio.preload = 'auto';
    this.bgAudio.loop = true;
    this.bgAudio.volume = 0.45;
    this.bgAudio.setAttribute('playsinline', 'true');
    this.bgAudio.setAttribute('webkit-playsinline', 'true');

    this.bgAudio.onerror = () => {
      if (this.bgAudio && this.bgAudio.src.includes('.mpeg')) {
        this.bgAudio.src = '/assets/audio/flying.mp3';
        this.bgAudio.load();
      }
    };

    this.crashAudio = new Audio('/assets/audio/flew-away.mp3.mpeg');
    this.crashAudio.preload = 'auto';
    this.crashAudio.loop = false;
    this.crashAudio.volume = 0.85;
    this.crashAudio.setAttribute('playsinline', 'true');
    this.crashAudio.setAttribute('webkit-playsinline', 'true');

    this.crashAudio.onerror = () => {
      if (this.crashAudio && this.crashAudio.src.includes('.mpeg')) {
        this.crashAudio.src = '/assets/audio/flew-away.mp3';
        this.crashAudio.load();
      }
    };

    // Listen to global click/touch to unlock HTML5 Audio autoplay restrictions
    document.addEventListener('click', () => this.unlock(), { once: false });
    document.addEventListener('touchstart', () => this.unlock(), { once: false });
  }

  private initVisibilityListeners(): void {
    if (typeof document === 'undefined') return;

    document.addEventListener('visibilitychange', () => {
      this.isTabVisible = !document.hidden;
      if (document.hidden) {
        this.stopAllAudio();
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        this.isTabVisible = false;
        this.stopAllAudio();
      });
    }
  }

  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;

    if (this.bgAudio) {
      this.bgAudio.load();
    }
    if (this.crashAudio) {
      this.crashAudio.load();
    }
  }

  playBackground(): void {
    if (!this.enabled || !this.isTabVisible || (typeof document !== 'undefined' && document.hidden)) {
      return;
    }
    if (this.isBgPlaying && this.bgAudio && !this.bgAudio.paused) {
      return; // Already playing cleanly, do not duplicate!
    }

    this.stopCrash();

    if (this.bgAudio) {
      this.bgAudio.currentTime = 0;
      this.isBgPlaying = true;
      this.bgAudio.play().catch(() => {
        this.isBgPlaying = false;
      });
    }
  }

  stopBackground(): void {
    this.isBgPlaying = false;
    if (this.bgAudio) {
      try {
        this.bgAudio.pause();
        this.bgAudio.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
  }

  playCrash(): void {
    this.stopBackground();
    if (!this.enabled || !this.isTabVisible || (typeof document !== 'undefined' && document.hidden)) {
      return;
    }

    if (this.crashAudio) {
      try {
        this.crashAudio.currentTime = 0;
        this.crashAudio.play().catch(() => {});
      } catch {
        /* ignore */
      }
    }
  }

  stopCrash(): void {
    if (this.crashAudio) {
      try {
        this.crashAudio.pause();
        this.crashAudio.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
  }

  stopAllAudio(): void {
    this.stopBackground();
    this.stopCrash();
  }

  playWin(): void {}
  updateEnginePitch(multiplier: number): void {}

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    localStorage.setItem('aviator_sound_enabled', String(enabled));
    if (!enabled) this.stopAllAudio();
  }
}
