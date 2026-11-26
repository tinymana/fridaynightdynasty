import type { Store } from './api';
import { RoomError, type Coach, type Room } from './room';

/** In-memory storage for tests and the local mock server. Not for production: nothing is persisted or hashed. */
export class MemoryStore implements Store {
  readonly coaches = new Map<string, { coach: Coach; pin: string; failed: number }>();
  readonly sessions = new Map<string, string>();
  readonly rooms = new Map<string, Room>();
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

  async dropRoomsOf(coachId: string, olderThan: number): Promise<void> {
    for (const [pin, r] of this.rooms) if (r.host.id === coachId || r.updatedAt < olderThan) this.rooms.delete(pin);
  }
}
