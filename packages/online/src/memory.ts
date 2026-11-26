import type { Career, Store } from './api';
import { RoomError, type Coach, type GameResult, type Room } from './room';

const blank = (name: string): Career => ({ name, games: 0, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, championships: 0, streak: 0, bestStreak: 0 });

/** Hall of Fame order: most wins, then best win rate, then point difference, then name. */
export function hallOrder(a: Career, b: Career): number {
  return b.wins - a.wins || b.wins * a.games - a.wins * b.games || (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst) || (a.name < b.name ? -1 : 1);
}

/** In-memory storage for tests and the local mock server. Not for production: nothing is persisted or hashed. */
export class MemoryStore implements Store {
  readonly coaches = new Map<string, { coach: Coach; pin: string; failed: number }>();
  readonly sessions = new Map<string, string>();
  readonly rooms = new Map<string, Room>();
  readonly careers = new Map<string, Career>();
  private nextId = 1;

  async signIn(name: string, pin: string) {
    const existing = this.coaches.get(name);
    if (!existing) {
      const coach = { id: `coach_${this.nextId++}`, name };
      this.coaches.set(name, { coach, pin, failed: 0 });
      return { coach, created: true };
    }
    if (existing.failed >= 5) return { error: 'locked' as const };
    if (existing.pin !== pin) {
      existing.failed++;
      return { error: 'wrong_pin' as const };
    }
    existing.failed = 0;
    return { coach: existing.coach, created: false };
  }

  async addSession(tokenHash: string, coachId: string): Promise<void> {
    this.sessions.set(tokenHash, coachId);
  }

  async coachForSession(tokenHash: string): Promise<Coach | null> {
    const id = this.sessions.get(tokenHash);
    for (const c of this.coaches.values()) if (c.coach.id === id) return c.coach;
    return null;
  }

  async createRoom(room: Room): Promise<boolean> {
    if (this.rooms.has(room.pin)) return false;
    this.rooms.set(room.pin, structuredClone(room));
    return true;
  }

  async withRoom<T>(pin: string, fn: (room: Room) => T): Promise<T> {
    const stored = this.rooms.get(pin);
    if (!stored) throw new RoomError('no_room', 'No game has that PIN.', 404);
    // Work on a copy so a rejected action changes nothing, as a rolled-back transaction would.
    const room = structuredClone(stored);
    const out = fn(room);
    this.rooms.set(pin, room);
    return out;
  }

  private nameOf(id: string): string {
    for (const c of this.coaches.values()) if (c.coach.id === id) return c.coach.name;
    return '';
  }

  async recordResult(r: GameResult): Promise<void> {
    for (const t of [0, 1] as const) {
      const id = r.coaches[t];
      const c = this.careers.get(id) ?? blank(this.nameOf(id));
      const mine = r.score[t];
      const theirs = r.score[t === 0 ? 1 : 0];
      c.games++;
      c.pointsFor += mine;
      c.pointsAgainst += theirs;
      if (mine > theirs) {
        c.wins++;
        c.streak++;
        c.bestStreak = Math.max(c.bestStreak, c.streak);
      } else {
        if (mine < theirs) c.losses++;
        else c.ties++;
        c.streak = 0;
      }
      this.careers.set(id, c);
    }
  }

  async careerOf(coachId: string): Promise<Career | null> {
    const name = this.nameOf(coachId);
    return name ? { ...(this.careers.get(coachId) ?? blank(name)) } : null;
  }

  async hallOfFame(limit: number): Promise<Career[]> {
    return [...this.careers.values()].filter((c) => c.games > 0).sort(hallOrder).slice(0, limit).map((c) => ({ ...c }));
  }

  async dropRoomsOf(coachId: string, olderThan: number): Promise<void> {
    for (const [pin, r] of this.rooms) if (r.host.id === coachId || r.updatedAt < olderThan) this.rooms.delete(pin);
  }
}
