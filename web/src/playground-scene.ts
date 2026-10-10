import {
  AmbientLight, BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry,
  DirectionalLight, EdgesGeometry, Fog, GridHelper, Group, LineBasicMaterial,
  LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera,
  Plane, Raycaster, RingGeometry, Scene, SphereGeometry, Vector2, Vector3, WebGLRenderer
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ScenarioObject, Vector3 as Position } from "../../src/domain/scenario.js";
import { objectTint, worldDimensions, worldPosition, type PlaygroundModel } from "./playground-model.js";

interface WorldItem {
  group: Group;
  label: HTMLButtonElement;
  tintMaterials: MeshStandardMaterial[];
  fingerprint: string;
}

/** Visual projection only. All movement and collisions remain server-owned. */
export class PlaygroundScene {
  private readonly scene = new Scene();
  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(45, 1, 0.01, 2000);
  private readonly controls: OrbitControls;
  private readonly labels = document.createElement("div");
  private readonly items = new Map<string, WorldItem>();
  private readonly raycaster = new Raycaster();
  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly selection = new Mesh(new RingGeometry(0.7, 0.85, 32), new MeshBasicMaterial({ color: 0xf3c8a9, depthTest: false, transparent: true, opacity: 0.95 }));
  private readonly resizeObserver: ResizeObserver;
  private readonly size: { width: number; depth: number };
  private readonly extent: number;
  private frame = 0;
  private lastFrameTime = 0;
  private disposed = false;
  private pointerStart: { x: number; y: number; id: number } | undefined;
  private selectedId: string | null = null;

  constructor(
    private readonly host: HTMLDivElement,
    model: PlaygroundModel,
    private readonly onSelect: (objectId: string) => void,
    private readonly onMoveTo: (position: Position) => void,
    private readonly onUnavailable: (message: string) => void
  ) {
    this.size = worldDimensions(model.environment);
    this.extent = Math.max(this.size.width, this.size.depth);
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(0x17343d);
    this.renderer.domElement.setAttribute("aria-label", "Interactive 3D exercise playground");
    this.renderer.domElement.tabIndex = 0;
    this.host.append(this.renderer.domElement);
    this.labels.className = "world-label-layer";
    this.host.append(this.labels);
    this.scene.background = new Color(0x17343d);
    this.scene.fog = new Fog(0x17343d, this.extent * 2, this.extent * 5);
    this.scene.add(new AmbientLight(0xc5dbea, 2.3));
    const light = new DirectionalLight(0xffedd0, 3);
    light.position.set(40, 80, 30);
    this.scene.add(light);

    const ground = new Mesh(new BoxGeometry(this.size.width, 0.3, this.size.depth), new MeshStandardMaterial({ color: 0x254953, roughness: 1 }));
    ground.position.y = -0.18;
    this.scene.add(ground);
    const grid = new GridHelper(this.extent, 24, 0x6b9899, 0x3e626a);
    grid.scale.set(this.size.width / this.extent, 1, this.size.depth / this.extent);
    grid.position.y = -0.02;
    this.scene.add(grid);
    this.selection.rotation.x = -Math.PI / 2;
    this.selection.renderOrder = 2;
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.camera.far = this.extent * 12;
    this.camera.updateProjectionMatrix();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minDistance = 1;
    this.controls.maxDistance = this.extent * 4;
    this.controls.addEventListener("change", this.requestRender);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.addEventListener("webglcontextlost", this.contextLost);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    this.resetCamera();
    this.update(model);
    this.resize();
  }

  update(model: PlaygroundModel): void {
    const retained = new Set(model.environment.objects.map((object) => object.id));
    for (const [id, item] of this.items) {
      if (retained.has(id)) continue;
      this.removeItem(item);
      this.items.delete(id);
    }
    for (const object of model.environment.objects) {
      const fingerprint = `${object.type}:${object.physics?.trigger ?? false}`;
      let item = this.items.get(object.id);
      if (item && item.fingerprint !== fingerprint) { this.removeItem(item); this.items.delete(object.id); item = undefined; }
      if (!item) { item = this.makeItem(object, fingerprint); this.items.set(object.id, item); }
      const position = worldPosition(object, model.bodies);
      item.group.position.set(position.x, position.y, position.z);
      // Keep the authored radians convention used by Forge transforms.
      item.group.rotation.y = Number.isFinite(object.transform.rotationY) ? object.transform.rotationY : 0;
      const safeScale = (value: number) => Number.isFinite(value) && value > 0 ? value : 1;
      item.group.scale.set(safeScale(object.transform.scale.x), safeScale(object.transform.scale.y), safeScale(object.transform.scale.z));
      const tint = objectTint(object, model);
      item.tintMaterials.forEach((material) => material.color.setHex(tint));
      item.label.textContent = object.name;
      item.label.title = object.name;
      item.label.style.setProperty("--object-tint", `#${tint.toString(16).padStart(6, "0")}`);
      item.label.setAttribute("aria-pressed", String(object.id === model.selectedId));
    }
    this.selectedId = model.selectedId;
    const selected = model.selectedId ? this.items.get(model.selectedId) : undefined;
    this.selection.visible = Boolean(selected);
    if (selected) {
      this.selection.position.copy(selected.group.position).add(new Vector3(0, 0.08, 0));
      const radius = Math.max(selected.group.scale.x, selected.group.scale.z, 1);
      this.selection.scale.set(radius, radius, 1);
    }
    this.host.dataset.objectCount = String(this.items.size);
    this.requestRender();
  }

  resetCamera(topDown = false): void {
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(topDown ? 0 : this.extent * 0.65, this.extent * 0.9, topDown ? 0.01 : this.extent * 0.8);
    this.controls.update();
    this.host.dataset.camera = topDown ? "overhead" : "perspective";
    this.requestRender();
  }

  focusSelected(): void {
    const selected = this.selectedId ? this.items.get(this.selectedId) : undefined;
    if (!selected) return;
    const offset = new Vector3(1, 1.2, 1.2).normalize().multiplyScalar(Math.max(6, selected.group.scale.length() * 5));
    this.controls.target.copy(selected.group.position);
    this.camera.position.copy(selected.group.position).add(offset);
    this.controls.update();
    this.host.dataset.camera = "focused";
    this.requestRender();
  }

  private makeItem(object: ScenarioObject, fingerprint: string): WorldItem {
    const group = new Group();
    group.userData.objectId = object.id;
    const tintMaterials: MeshStandardMaterial[] = [];
    const add = (geometry: BufferGeometry, x: number, y: number, z: number, tinted = true, color = 0x233747) => {
      const material = new MeshStandardMaterial({ color: tinted ? 0x9fc3b0 : color, roughness: 0.9, flatShading: true });
      if (tinted) tintMaterials.push(material);
      const mesh = new Mesh(geometry, material);
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };
    if (["zone", "objective-area", "hazard", "route", "spawn-point"].includes(object.type)) {
      const tile = add(new BoxGeometry(1, 0.12, 1), 0, 0.06, 0);
      tile.material.transparent = true;
      tile.material.opacity = 0.45;
      const outline = new LineSegments(new EdgesGeometry(tile.geometry), new LineBasicMaterial({ color: 0xb9d6d1 }));
      outline.position.copy(tile.position);
      group.add(outline);
    } else if (object.type === "command-post" || object.type === "location" || object.type === "checkpoint") {
      add(new BoxGeometry(1.4, 0.85, 1.2), 0, 0.425, 0);
      const roof = add(new ConeGeometry(1.05, 0.5, 4), 0, 1.1, 0, false);
      roof.rotation.y = Math.PI / 4;
      add(new BoxGeometry(0.35, 0.5, 0.04), 0, 0.25, 0.62, false, 0x0a1925);
    } else if (object.type === "team" || object.type === "unit") {
      add(new BoxGeometry(1, 0.4, 1.8), 0, 0.45, 0);
      add(new BoxGeometry(0.8, 0.4, 0.75), 0, 0.83, -0.22);
      for (const x of [-0.52, 0.52]) for (const z of [-0.55, 0.55]) {
        const wheel = add(new CylinderGeometry(0.23, 0.23, 0.18, 8), x, 0.23, z, false, 0x09111a);
        wheel.rotation.z = Math.PI / 2;
      }
    } else if (["relay-node", "channel-node", "sensor", "report-source", "observation-point"].includes(object.type)) {
      add(new CylinderGeometry(0.12, 0.3, 1.7, 6), 0, 0.85, 0);
      add(new SphereGeometry(0.4, 6, 4), 0, 1.85, 0);
      add(new CylinderGeometry(0.025, 0.025, 0.65, 4), 0, 2.35, 0, false, 0xbdd6e4);
    } else {
      add(new BoxGeometry(1, 0.8, 1), 0, 0.4, 0);
      add(new BoxGeometry(1.08, 0.08, 1.08), 0, 0.84, 0, false);
    }
    const label = document.createElement("button");
    label.type = "button";
    label.className = "world-label";
    label.dataset.objectId = object.id;
    label.addEventListener("click", () => this.onSelect(object.id));
    this.labels.append(label);
    this.scene.add(group);
    return { group, label, tintMaterials, fingerprint };
  }

  private pointerDown = (event: PointerEvent): void => { this.pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId }; };
  private pointerUp = (event: PointerEvent): void => {
    if (!this.pointerStart || this.pointerStart.id !== event.pointerId || Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 5 || event.button !== 0) return;
    this.pointerStart = undefined;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), this.camera);
    if (event.shiftKey) {
      const point = this.raycaster.ray.intersectPlane(this.groundPlane, new Vector3());
      if (point && Math.abs(point.x) <= this.size.width / 2 && Math.abs(point.z) <= this.size.depth / 2) this.onMoveTo({ x: point.x, y: point.y, z: point.z });
      return;
    }
    const hit = this.raycaster.intersectObjects([...this.items.values()].map((item) => item.group), true)[0];
    let node = hit?.object;
    while (node && !node.userData.objectId) node = node.parent ?? undefined;
    if (node) this.onSelect(String(node.userData.objectId));
    this.renderer.domElement.focus({ preventScroll: true });
  };
  private contextLost = (event: Event): void => {
    event.preventDefault();
    this.onUnavailable("The 3D graphics context was lost. The plan view remains available; retry 3D when ready.");
  };
  private resize = (): void => {
    if (this.disposed) return;
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  };
  private requestRender = (): void => {
    if (!this.disposed && !this.frame) this.frame = requestAnimationFrame(this.render);
  };
  private render = (time: number): void => {
    this.frame = 0;
    if (this.disposed) return;
    if (time - this.lastFrameTime < 1000 / 30) { this.requestRender(); return; }
    this.lastFrameTime = time;
    this.renderer.render(this.scene, this.camera);
    const point = new Vector3();
    const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    // Place the selected label first, then stack nearby labels rather than
    // obscuring each other in an overview. The selector retains every object.
    const items = [...this.items.entries()].sort(([left], [right]) => Number(right === this.selectedId) - Number(left === this.selectedId));
    for (const [, item] of items) {
      point.copy(item.group.position).add(new Vector3(0, Math.max(1.4, item.group.scale.y * 2.7), 0)).project(this.camera);
      item.label.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
      if (item.label.hidden) continue;
      const labelWidth = item.label.offsetWidth;
      const labelHeight = item.label.offsetHeight;
      const x = Math.max(labelWidth / 2 + 4, Math.min(width - labelWidth / 2 - 4, (point.x + 1) / 2 * width));
      let bottom = Math.max(labelHeight + 4, (1 - point.y) / 2 * height);
      let rectangle = { left: x - labelWidth / 2, right: x + labelWidth / 2, top: bottom - labelHeight, bottom };
      const overlaps = () => occupied.some((other) => rectangle.left < other.right + 4 && rectangle.right > other.left - 4 && rectangle.top < other.bottom + 4 && rectangle.bottom > other.top - 4);
      while (overlaps() && rectangle.top >= 4) {
        bottom -= labelHeight + 5;
        rectangle = { ...rectangle, top: bottom - labelHeight, bottom };
      }
      if (rectangle.top < 4) { item.label.hidden = true; continue; }
      occupied.push(rectangle);
      item.label.style.left = `${x}px`;
      item.label.style.top = `${bottom}px`;
    }
    this.host.dataset.rendered = "true";
    this.host.dataset.drawCalls = String(this.renderer.info.render.calls);
    this.host.dataset.frames = String(Number(this.host.dataset.frames ?? 0) + 1);
  };

  private removeItem(item: WorldItem): void { this.scene.remove(item.group); disposeObject(item.group); item.label.remove(); }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.removeEventListener("change", this.requestRender);
    this.controls.dispose();
    this.renderer.domElement.removeEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.contextLost);
    disposeObject(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labels.remove();
    this.items.clear();
  }
}

function disposeObject(root: Scene | Group): void {
  root.traverse((node) => {
    if (node instanceof Mesh || node instanceof LineSegments || node instanceof GridHelper) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => material.dispose());
    }
  });
}
