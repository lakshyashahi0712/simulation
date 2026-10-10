import type { ScenarioObject, Vector3 } from "../domain/scenario.js";

export interface PhysicsBodyState {
  objectId: string;
  position: Vector3;
  velocity: Vector3;
}

export interface PhysicsContact {
  objectId: string;
  otherObjectId: string;
  trigger: boolean;
}

export interface PhysicsWorldSnapshot {
  bodies: PhysicsBodyState[];
  activeContacts: string[];
}

const clone = <T>(value: T): T => structuredClone(value);

export class PhysicsWorld {
  private readonly objects = new Map<string, ScenarioObject>();
  private readonly bodies = new Map<string, PhysicsBodyState>();
  private readonly activeContacts = new Set<string>();

  constructor(objects: ScenarioObject[]) {
    for (const object of objects) {
      if (!object.physics || object.physics.collider === "none") continue;
      this.objects.set(object.id, clone(object));
      this.bodies.set(object.id, {
        objectId: object.id,
        position: clone(object.transform.position),
        velocity: { x: 0, y: 0, z: 0 }
      });
    }
  }

  getBody(objectId: string): PhysicsBodyState {
    const body = this.bodies.get(objectId);
    if (!body) throw new Error(`Object ${objectId} does not have a physics body.`);
    return clone(body);
  }

  setPose(objectId: string, position: Vector3, velocity?: Vector3): PhysicsBodyState {
    const body = this.bodies.get(objectId);
    const object = this.objects.get(objectId);
    if (!body || !object) throw new Error(`Object ${objectId} does not have a physics body.`);
    if (object.physics?.body === "fixed") throw new Error(`Fixed object ${objectId} cannot be moved.`);
    body.position = clone(position);
    if (velocity) body.velocity = clone(velocity);
    return clone(body);
  }

  step(seconds: number): PhysicsContact[] {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Physics step must be a non-negative finite duration.");
    for (const [objectId, body] of this.bodies) {
      const object = this.objects.get(objectId);
      if (object?.physics?.body !== "dynamic") continue;
      body.position = {
        x: body.position.x + body.velocity.x * seconds,
        y: body.position.y + body.velocity.y * seconds,
        z: body.position.z + body.velocity.z * seconds
      };
    }

    const contacts: PhysicsContact[] = [];
    const bodies = [...this.bodies.values()];
    for (let index = 0; index < bodies.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < bodies.length; otherIndex += 1) {
        const left = bodies[index];
        const right = bodies[otherIndex];
        if (!left || !right || !this.intersects(left.objectId, right.objectId)) continue;
        const leftObject = this.objects.get(left.objectId);
        const rightObject = this.objects.get(right.objectId);
        const trigger = Boolean(leftObject?.physics?.trigger || rightObject?.physics?.trigger);
        const key = this.contactKey(left.objectId, right.objectId);
        if (!this.activeContacts.has(key)) contacts.push({ objectId: left.objectId, otherObjectId: right.objectId, trigger });
        this.activeContacts.add(key);
        this.resolveElasticContact(left, right, leftObject, rightObject);
      }
    }

    for (const key of [...this.activeContacts]) {
      const [leftId, rightId] = key.split("|");
      if (leftId && rightId && !this.intersects(leftId, rightId)) this.activeContacts.delete(key);
    }
    return clone(contacts);
  }

  snapshot(): PhysicsWorldSnapshot {
    return clone({ bodies: [...this.bodies.values()], activeContacts: [...this.activeContacts] });
  }

  restore(snapshot: PhysicsWorldSnapshot): void {
    this.bodies.forEach((body) => {
      const restored = snapshot.bodies.find((candidate) => candidate.objectId === body.objectId);
      if (restored) Object.assign(body, clone(restored));
    });
    this.activeContacts.clear();
    snapshot.activeContacts.forEach((key) => this.activeContacts.add(key));
  }

  private intersects(leftId: string, rightId: string): boolean {
    const left = this.bodies.get(leftId);
    const right = this.bodies.get(rightId);
    const leftObject = this.objects.get(leftId);
    const rightObject = this.objects.get(rightId);
    if (!left || !right || !leftObject || !rightObject) return false;
    const leftRadius = this.radius(leftObject);
    const rightRadius = this.radius(rightObject);
    const dx = left.position.x - right.position.x;
    const dy = left.position.y - right.position.y;
    const dz = left.position.z - right.position.z;
    return dx * dx + dy * dy + dz * dz <= (leftRadius + rightRadius) ** 2;
  }

  private radius(object: ScenarioObject): number {
    const scale = object.transform.scale;
    if (object.physics?.collider === "sphere" || object.physics?.collider === "capsule") return Math.max(scale.x, scale.y, scale.z) / 2;
    return Math.sqrt(scale.x ** 2 + scale.y ** 2 + scale.z ** 2) / 2;
  }

  private resolveElasticContact(left: PhysicsBodyState, right: PhysicsBodyState, leftObject?: ScenarioObject, rightObject?: ScenarioObject): void {
    if (leftObject?.physics?.body !== "dynamic" || rightObject?.physics?.body !== "dynamic") return;
    const nextLeft = left.velocity;
    left.velocity = clone(right.velocity);
    right.velocity = clone(nextLeft);
  }

  private contactKey(leftId: string, rightId: string): string {
    return [leftId, rightId].sort().join("|");
  }
}
