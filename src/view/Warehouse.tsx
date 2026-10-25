import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Evaluation, SceneSpec, Scenario, WorldState } from '../core/types';

export type Poses = Record<string, [number, number]>;
type Props = {
  scenario: Scenario;
  sceneSpec?: SceneSpec;
  state: WorldState;
  poses: Poses;
  evaluation: Evaluation | null;
  camera: 'orbit' | 'top';
  routes: boolean;
  onCell: (cell: [number, number]) => void;
  placing: boolean;
  onRenderedPositions: (positions: Poses) => void;
};

const colorFor = (index: number) => (index === 0 ? '#57ddc8' : '#fb9b6c');
function label(text: string, color = '#d1e0df') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 34px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 48);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthTest: false,
    }),
  );
  sprite.scale.set(1.3, 0.49, 1);
  return sprite;
}

export function Warehouse(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const el = host.current!;
    const workshop = props.sceneSpec?.style.palette === 'cloud-workshop';
    const background = workshop ? '#18292c' : '#151b20';
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);
    scene.fog = new THREE.Fog(background, 21, 42);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      'aria-label',
      'Interactive three dimensional warehouse simulation',
    );
    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 100);
    const target = new THREE.Vector3(0, 0, 0);
    let angle = -0.73;
    let radius = 17;
    let dragging = false;
    let lastX = 0;
    let moved = 0;
    scene.add(new THREE.HemisphereLight('#d6e6ec', '#242c30', 2.5));
    const key = new THREE.DirectionalLight('#fff0d7', 4);
    key.position.set(-5, 12, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.normalBias = 0.025;
    key.shadow.bias = -0.0002;
    scene.add(key);
    const fill = new THREE.PointLight('#54cdbb', 12, 15);
    fill.position.set(4, 4, -5);
    scene.add(fill);
    const world = new THREE.Group();
    scene.add(world);
    const workshopPalette: Record<string, string> = {
      '#34434b': '#3c6265',
      '#56666b': '#689190',
      '#9c9684': '#b4b29a',
    };
    const material = (color: string, roughness = 0.7, metalness = 0.05) =>
      new THREE.MeshStandardMaterial({
        color: workshop ? workshopPalette[color] || color : color,
        roughness,
        metalness,
      });
    const box = (
      w: number,
      h: number,
      d: number,
      color: string,
      x: number,
      y: number,
      z: number,
      group: THREE.Group = world,
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    box(9.05, 0.35, 9.05, '#29333a', 0, -0.3, 0);
    box(8.8, 0.08, 8.8, '#576267', 0, -0.08, 0);
    box(9.15, 0.08, 0.045, '#7c8b8d', 0, -0.18, 4.55);
    box(0.045, 0.08, 9.15, '#7c8b8d', -4.55, -0.18, 0);
    const blocked = new Set(props.scenario.blocked.map((c) => c.join(',')));
    const grainCanvas = document.createElement('canvas');
    grainCanvas.width = 128;
    grainCanvas.height = 128;
    const grainContext = grainCanvas.getContext('2d')!;
    const grainImage = grainContext.createImageData(128, 128);
    for (let i = 0; i < grainImage.data.length; i += 4) {
      const shade = 230 + ((i * 73 + (i >> 5) * 19) % 22);
      grainImage.data[i] = shade;
      grainImage.data[i + 1] = shade;
      grainImage.data[i + 2] = shade;
      grainImage.data[i + 3] = 255;
    }
    grainContext.putImageData(grainImage, 0, 0);
    const grain = new THREE.CanvasTexture(grainCanvas);
    grain.colorSpace = THREE.SRGBColorSpace;
    const floorMaterials = ['#667175', '#626e72'].map(
      (color) => new THREE.MeshStandardMaterial({ color, map: grain, roughness: 0.94 }),
    );
    const coord = (x: number) => x - 3.5;
    for (let x = 0; x < 8; x++)
      for (let z = 0; z < 8; z++) {
        const X = coord(x),
          Z = coord(z),
          isBlock = blocked.has(`${x},${z}`);
        const tile = box(
          0.975,
          0.045,
          0.975,
          isBlock ? '#434d51' : (x + z) % 2 ? '#667175' : '#626e72',
          X,
          -0.017,
          Z,
        );
        tile.userData.cell = [x, z];
        if (!isBlock) {
          (tile.material as THREE.Material).dispose();
          tile.material = floorMaterials[(x + z) % 2];
        }
        if (isBlock) {
          // Low industrial storage racks preserve visibility into the narrow test aisles.
          const rack = new THREE.Group();
          rack.position.set(X, 0, Z);
          world.add(rack);
          for (const dx of [-0.35, 0.35])
            for (const dz of [-0.32, 0.32]) box(0.045, 0.91, 0.045, '#34434b', dx, 0.46, dz, rack);
          for (const h of [0.14, 0.52, 0.91]) box(0.78, 0.045, 0.73, '#56666b', 0, h, 0, rack);
          box(0.29, 0.28, 0.5, '#8c9389', -0.18, 0.3, 0, rack);
          box(0.28, 0.28, 0.47, '#747f7b', 0.17, 0.3, 0.025, rack);
          box(0.59, 0.29, 0.51, '#9c9684', 0, 0.69, 0, rack);
          box(0.045, 0.25, 0.515, '#c8b897', 0.04, 0.69, 0, rack);
          box(0.19, 0.045, 0.012, '#d4c38b', -0.18, 0.35, 0.26, rack);
        } else {
          for (const dx of [-0.43, 0.43]) box(0.025, 0.008, 0.19, '#a4aaa2', X + dx, 0.012, Z);
        }
      }
    // A modest apron, access markings and numbered bays anchor the scene as a physical testbed.
    for (let n = 0; n < 8; n++) {
      const text = label(String(n + 1).padStart(2, '0'), '#788b92');
      text.position.set(coord(n), -0.12, 4.9);
      text.scale.multiplyScalar(0.55);
      world.add(text);
    }
    const aisleText = label('F L E E T F O R G E', '#6c7d83');
    aisleText.position.set(0, -0.22, -4.82);
    aisleText.scale.set(3.7, 1.38, 1);
    world.add(aisleText);
    for (const decoration of props.sceneSpec?.decorations || []) {
      const decorationGroup = new THREE.Group();
      decorationGroup.position.set(coord(decoration.cell[0]), 0.94, coord(decoration.cell[1]));
      world.add(decorationGroup);
      if (decoration.kind === 'crate') {
        box(0.47, decoration.height, 0.47, '#c1a486', 0, decoration.height / 2, 0, decorationGroup);
        box(
          0.055,
          decoration.height + 0.003,
          0.474,
          '#e3c8a1',
          0,
          decoration.height / 2,
          0,
          decorationGroup,
        );
      } else if (decoration.kind === 'cloud') {
        for (const [x, y, size] of [
          [-0.18, 0.15, 0.18],
          [0, 0.22, 0.24],
          [0.2, 0.13, 0.17],
        ]) {
          const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(size, 14, 10),
            material('#b3d2cd'),
          );
          sphere.position.set(x, y, 0);
          sphere.castShadow = true;
          decorationGroup.add(sphere);
        }
      } else {
        const feather = box(0.14, 0.04, 0.56, '#a9d1c8', 0, 0.1, 0, decorationGroup);
        feather.rotation.y = 0.6;
        feather.rotation.z = -0.15;
      }
    }
    const robotGroups: Record<string, THREE.Group> = {};
    const cargos: Record<string, THREE.Group> = {};
    props.scenario.robots.forEach((robot, index) => {
      const tint = robot.color || colorFor(index);
      for (const [cell, isDrop] of [
        [robot.pickup, false],
        [robot.dropoff, true],
      ] as const) {
        const dock = new THREE.Mesh(
          new THREE.PlaneGeometry(0.84, 0.84),
          new THREE.MeshBasicMaterial({
            color: tint,
            transparent: true,
            opacity: 0.14,
            side: THREE.DoubleSide,
          }),
        );
        dock.rotation.x = -Math.PI / 2;
        dock.position.set(coord(cell[0]), 0.013, coord(cell[1]));
        world.add(dock);
        for (const edge of [-0.4, 0.4])
          box(0.025, 0.015, 0.84, tint, coord(cell[0]) + edge, 0.025, coord(cell[1]));
        const mark = label(isDrop ? '↓' : '↑', tint);
        mark.position.set(coord(cell[0]), 0.07, coord(cell[1]));
        mark.scale.set(0.45, 0.19, 1);
        world.add(mark);
      }
      const agv = new THREE.Group();
      world.add(agv);
      robotGroups[robot.id] = agv;
      box(0.62, 0.16, 0.73, '#19272c', 0, 0.13, 0, agv);
      box(0.58, 0.12, 0.64, tint, 0, 0.25, 0, agv);
      box(0.48, 0.045, 0.5, '#cbd6d5', 0, 0.33, 0, agv);
      for (const x of [-0.31, 0.31])
        for (const z of [-0.22, 0.22]) {
          const wheel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.095, 0.095, 0.06, 12),
            material('#142025'),
          );
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(x, 0.1, z);
          agv.add(wheel);
        }
      box(0.32, 0.055, 0.065, '#e4f9f0', 0, 0.23, -0.34, agv);
      box(0.15, 0.075, 0.12, '#1c3238', 0, 0.38, -0.2, agv);
      const sensor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16),
        material('#1b393d'),
      );
      sensor.position.set(0, 0.44, -0.2);
      agv.add(sensor);
      const cargo = new THREE.Group();
      agv.add(cargo);
      box(0.36, 0.29, 0.34, '#cfb697', 0, 0.51, 0.06, cargo);
      box(0.055, 0.293, 0.344, '#e4d5bb', 0, 0.51, 0.06, cargo);
      cargos[robot.id] = cargo;
      const tag = label(robot.id.toUpperCase(), tint);
      tag.position.set(0, 0.87, 0);
      tag.scale.set(0.8, 0.3, 1);
      agv.add(tag);
    });
    const routeGroup = new THREE.Group();
    world.add(routeGroup);
    let lastEvaluation: Evaluation | null | undefined;
    const dynamic = new THREE.Group();
    world.add(dynamic);
    let lastBlocks = '';
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const down = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      moved = 0;
      el.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      const delta = event.clientX - lastX;
      moved += Math.abs(delta);
      angle -= delta * 0.007;
      lastX = event.clientX;
    };
    const up = (event: PointerEvent) => {
      dragging = false;
      if (moved < 5 && latest.current.placing) {
        const rect = el.getBoundingClientRect();
        mouse.set(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(mouse, camera);
        const hit = raycaster
          .intersectObjects(world.children)
          .find((item) => item.object.userData.cell);
        if (hit) latest.current.onCell(hit.object.userData.cell);
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      radius = THREE.MathUtils.clamp(radius + e.deltaY * 0.008, 12, 25);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false });
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    const initialRadius = radius * Math.max(1, 1.25 / camera.aspect);
    camera.position.set(
      Math.sin(angle) * initialRadius * 0.76,
      initialRadius * 0.75,
      Math.cos(angle) * initialRadius * 0.76,
    );
    let frame = 0;
    const animate = () => {
      const p = latest.current;
      const fitRadius = radius * Math.max(1, 1.25 / camera.aspect);
      if (p.camera === 'top') camera.position.lerp(new THREE.Vector3(0, fitRadius, 0.01), 0.08);
      else
        camera.position.lerp(
          new THREE.Vector3(
            Math.sin(angle) * fitRadius * 0.76,
            fitRadius * 0.75,
            Math.cos(angle) * fitRadius * 0.76,
          ),
          0.08,
        );
      camera.lookAt(target);
      p.scenario.robots.forEach((robot) => {
        const agv = robotGroups[robot.id];
        const pose = p.poses[robot.id] || robot.start;
        const next = new THREE.Vector3(coord(pose[0]), 0.03, coord(pose[1]));
        const delta = next.clone().sub(agv.position);
        if (delta.length() > 0.005) agv.rotation.y = Math.atan2(delta.x, delta.z);
        agv.position.copy(next);
        cargos[robot.id].visible =
          Boolean(p.state.carrying[robot.id]) && !p.state.delivered[robot.id];
      });
      if (lastEvaluation !== p.evaluation) {
        routeGroup.clear();
        lastEvaluation = p.evaluation;
        if (p.evaluation)
          p.scenario.robots.forEach((robot, index) => {
            const cells = [
              p.evaluation!.trace.initial.positions[robot.id],
              ...p.evaluation!.trace.transitions.map((t) => t.after.positions[robot.id]),
            ];
            const points = cells.map(
              (c) => new THREE.Vector3(coord(c[0]), 0.04 + index * 0.012, coord(c[1])),
            );
            const line = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(points),
              new THREE.LineBasicMaterial({
                color: robot.color || colorFor(index),
                transparent: true,
                opacity: 0.65,
              }),
            );
            routeGroup.add(line);
          });
      }
      routeGroup.visible = p.routes;
      const active = p.state.activeBlocks.filter((c) => !blocked.has(c.join(',')));
      const blocksKey = JSON.stringify(active);
      if (blocksKey !== lastBlocks) {
        dynamic.clear();
        lastBlocks = blocksKey;
        active.forEach((cell) => {
          box(0.79, 0.27, 0.36, '#c87843', coord(cell[0]), 0.15, coord(cell[1]), dynamic);
          for (let i = 0; i < 4; i++) {
            const stripe = box(
              0.075,
              0.21,
              0.37,
              '#e6c987',
              coord(cell[0]) - 0.28 + i * 0.17,
              0.18,
              coord(cell[1]),
              dynamic,
            );
            stripe.rotation.z = -0.3;
          }
        });
      }
      renderer.render(scene, camera);
      p.onRenderedPositions(
        Object.fromEntries(
          Object.entries(robotGroups).map(([id, group]) => [
            id,
            [group.position.x + 3.5, group.position.z + 3.5],
          ]),
        ),
      );
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Sprite) {
          obj.geometry?.dispose();
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          materials.forEach((m) => {
            (m as THREE.SpriteMaterial).map?.dispose();
            m.dispose();
          });
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [props.scenario, props.sceneSpec]);
  return (
    <div
      className={`warehouse ${props.placing ? 'placing' : ''}`}
      ref={host}
      data-testid="warehouse-canvas"
    />
  );
}
