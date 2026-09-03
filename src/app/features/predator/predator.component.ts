import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { API_BASE_URL } from '../../core/config/api-url';
import { GameSocketService } from '../../core/services/game-socket.service';

interface PredatorResponse {
  decision: { roundNumber: number; lockedCrashPoint: number | null; lockedAt: string | null; status: string; phase: string; note: string };
  prediction: { predictedCrashPoint: number; confidence: string; trend: string; basedOn: string; recommendation: string };
  currentState: { phase: string; currentMultiplier: number; crashPoint: number | null; history: number[] };
  timestamp: string;
}

@Component({
  selector: 'app-predator',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    :host{display:block;min-height:100vh;background:#0a0e17;color:#fff;font-family:Inter,system-ui,sans-serif}.page{max-width:1280px;margin:0 auto;padding:24px}.head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:24px}.eyebrow{color:#64748b;font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase}.head h1{color:#ff0058;font-size:34px;margin:4px 0}.sub{color:#94a3b8;margin:0}.head-actions{display:flex;gap:8px;flex-wrap:wrap}.head-actions button{background:rgba(255,255,255,.08);border:0;border-radius:10px;color:#fff;cursor:pointer;font:700 14px inherit;padding:10px 14px}.head-actions button.primary{background:#ff0058}.grid{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:16px}.stack{display:grid;gap:16px}.card{background:#111827;border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:20px}.prediction{background:linear-gradient(135deg,#111827,#0f172a)}.label{color:#64748b;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase}.value{font-size:62px;font-weight:900;margin:10px 0 0}.locked{color:#22c55e}.pending{color:#facc15}.tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.tag{background:rgba(255,255,255,.08);border-radius:999px;color:#cbd5e1;font-size:12px;font-weight:700;padding:6px 10px}.chart{height:170px;width:100%;margin-top:12px}.rounds{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:12px}.round{background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px;text-align:center}.round small{color:#64748b}.round strong{display:block;color:#38bdf8;margin-top:2px}.stat{align-items:center;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.08);border-radius:10px;display:flex;justify-content:space-between;margin-top:10px;padding:12px}.stat span{color:#94a3b8;font-size:12px}.stat strong{color:#60a5fa}.error{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);border-radius:10px;color:#fecaca;margin-bottom:16px;padding:12px}@media(max-width:900px){.grid{grid-template-columns:1fr}.rounds{grid-template-columns:repeat(4,1fr)}}@media(max-width:560px){.page{padding:16px}.value{font-size:48px}}
  `],
  template: `
    <main class="page">
      <header class="head"><div><div class="eyebrow">Admin analysis</div><h1>Predator</h1><p class="sub">Live round decision board</p></div><div class="head-actions"><button class="primary" (click)="load()">Refresh</button><button (click)="router.navigate(['/admin'])">Admin</button><button (click)="router.navigate(['/'])">Game</button></div></header>
      <p *ngIf="error" class="error">{{ error }}</p>
      <section class="grid" *ngIf="data; else loading"><div class="stack"><article class="card prediction"><div class="label">Round #{{ data.decision.roundNumber }} prediction</div><div class="value" [class.locked]="isLocked" [class.pending]="!isLocked">{{ isLocked ? (data.decision.lockedCrashPoint | number:'1.2-2') + 'x' : '~' + (data.prediction.predictedCrashPoint | number:'1.2-2') + 'x' }}</div><p class="sub">{{ isLocked ? 'Engine locked. This active round will resolve at this point.' : 'Waiting for the next engine lock.' }}</p><div class="tags"><span class="tag">{{ data.decision.status | uppercase }}</span><span class="tag">{{ isLocked ? '100% ENGINE LOCK' : 'ESTIMATE ONLY' }}</span><span class="tag">Phase: {{ data.currentState.phase }}</span></div></article><article class="card"><div class="label">Recent crashes</div><svg class="chart" viewBox="0 0 860 220" preserveAspectRatio="none"><defs><linearGradient id="predatorLine" x1="0" x2="1"><stop offset="0%" stop-color="#ff0058"/><stop offset="100%" stop-color="#ffd166"/></linearGradient></defs><polyline *ngIf="sparkPoints" [attr.points]="sparkPoints" fill="none" stroke="url(#predatorLine)" stroke-width="5" stroke-linecap="round"/></svg></article><article class="card"><div class="label">Recent rounds</div><div class="rounds"><div class="round" *ngFor="let value of data.currentState.history | slice:0:16; let index = index"><small>#{{ index + 1 }}</small><strong>{{ value | number:'1.2-2' }}x</strong></div></div></article></div><aside class="stack"><article class="card"><div class="label">Live status</div><div class="stat"><span>Multiplier</span><strong>{{ data.currentState.currentMultiplier | number:'1.2-2' }}x</strong></div><div class="stat"><span>Phase</span><strong>{{ data.currentState.phase | uppercase }}</strong></div><div class="stat"><span>Updated</span><strong>{{ lastUpdated }}</strong></div></article><article class="card"><div class="label">Engine decision</div><p class="sub">{{ data.decision.note }}</p><div class="value" [class.locked]="isLocked" [class.pending]="!isLocked">{{ isLocked ? (data.decision.lockedCrashPoint | number:'1.2-2') + 'x' : 'Waiting...' }}</div></article><article class="card"><div class="label">Recommendation</div><h2>{{ data.prediction.recommendation }}</h2><p class="sub">{{ data.prediction.basedOn }}</p></article></aside></section>
      <ng-template #loading><article class="card">Loading Predator data…</article></ng-template>
    </main>
  `
})
export class PredatorComponent implements OnInit, OnDestroy {
  readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly gameSocket = inject(GameSocketService);
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly subscriptions = new Subscription();
  private requestInFlight = false;
  private refreshQueued = false;
  private lastRoundKey = '';
  data: PredatorResponse | null = null;
  error = '';
  lastUpdated = '';

  get isLocked(): boolean {
    return this.data?.decision.status?.toLowerCase() === 'locked'
      && Number.isFinite(this.data.decision.lockedCrashPoint);
  }
  get sparkPoints(): string {
    const history = this.data?.currentState.history.slice(0, 24).filter(value => Number.isFinite(value) && value > 0) || [];
    if (history.length < 2) return '';
    const min = Math.min(...history); const max = Math.max(...history); const range = Math.max(.5, max - min);
    return history.map((value, index) => `${(index * 860 / (history.length - 1)).toFixed(1)},${(202 - ((value - min) / range) * 184).toFixed(1)}`).join(' ');
  }

  ngOnInit(): void {
    const token = this.auth.getToken();
    if (!token) { this.router.navigate(['/login']); return; }
    // Match the reference screen: the route guard has already verified the
    // admin role, so fetch immediately instead of waiting on a second profile
    // request that can leave the board on its loading state.
    this.startLiveUpdates(token);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.subscriptions.unsubscribe();
    this.gameSocket.disconnect();
  }

  load(): void {
    if (this.requestInFlight) {
      this.refreshQueued = true;
      return;
    }
    this.requestInFlight = true;
    this.http.get<PredatorResponse>(`${API_BASE_URL}/predator`, { headers: this.auth.getAuthHeaders() }).subscribe({
      next: data => {
        this.data = this.normalizeResponse(data);
        this.error = '';
        this.lastUpdated = new Date().toLocaleTimeString();
        this.finishRequest();
        this.cdr.detectChanges();
      },
      error: error => {
        this.error = error?.error?.message || 'Unable to load Predator data.';
        this.finishRequest();
        this.cdr.detectChanges();
      }
    });
  }

  private startLiveUpdates(token: string): void {
    this.load();
    this.refreshTimer = setInterval(() => this.load(), 1500);
    this.gameSocket.connect(token);
    this.subscriptions.add(this.gameSocket.roundState$.subscribe(state => {
      const roundKey = `${state.roundId || ''}:${state.phase}`;
      if (!state.roundId || roundKey === this.lastRoundKey) return;
      this.lastRoundKey = roundKey;
      this.load();
    }));
  }

  private finishRequest(): void {
    this.requestInFlight = false;
    if (!this.refreshQueued) return;
    this.refreshQueued = false;
    this.load();
  }

  private normalizeResponse(payload: PredatorResponse): PredatorResponse {
    const toNumber = (value: unknown, fallback: number) => {
      const numberValue = Number(value);
      return Number.isFinite(numberValue) ? numberValue : fallback;
    };
    const lockedPoint = Number(payload?.decision?.lockedCrashPoint);
    const history = Array.isArray(payload?.currentState?.history)
      ? payload.currentState.history.map(value => Number(value)).filter(value => Number.isFinite(value) && value > 0)
      : [];

    return {
      decision: {
        roundNumber: toNumber(payload?.decision?.roundNumber, 0),
        lockedCrashPoint: Number.isFinite(lockedPoint) ? lockedPoint : null,
        lockedAt: payload?.decision?.lockedAt || null,
        status: payload?.decision?.status || 'completed',
        phase: payload?.decision?.phase || 'idle',
        note: payload?.decision?.note || 'Waiting for engine...',
      },
      prediction: {
        predictedCrashPoint: toNumber(payload?.prediction?.predictedCrashPoint, 1.5),
        confidence: payload?.prediction?.confidence || 'low',
        trend: payload?.prediction?.trend || 'neutral',
        basedOn: payload?.prediction?.basedOn || '',
        recommendation: payload?.prediction?.recommendation || 'Please wait',
      },
      currentState: {
        phase: payload?.currentState?.phase || 'idle',
        currentMultiplier: toNumber(payload?.currentState?.currentMultiplier, 1),
        crashPoint: Number.isFinite(Number(payload?.currentState?.crashPoint)) ? Number(payload.currentState.crashPoint) : null,
        history,
      },
      timestamp: payload?.timestamp || new Date().toISOString(),
    };
  }
}
