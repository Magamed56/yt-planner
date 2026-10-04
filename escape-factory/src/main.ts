import * as THREE from 'three';

// Phase 1 boot check: renders a lit scene so headless WebGL can be verified.
const root = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
root.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#ffb36b');
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(4, 4, 6);
camera.lookAt(0, 0.5, 0);
scene.add(new THREE.HemisphereLight('#ffffff', '#554433', 1.2));
const sun = new THREE.DirectionalLight('#ffffff', 2);
sun.position.set(5, 10, 4);
sun.castShadow = true;
scene.add(sun);
const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 10), new THREE.MeshStandardMaterial({ color: '#4a6fa5' }));
floor.position.y = -0.25;
floor.receiveShadow = true;
scene.add(floor);
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 16), new THREE.MeshStandardMaterial({ color: '#ff5533' }));
ball.position.y = 0.8;
ball.castShadow = true;
scene.add(ball);
renderer.render(scene, camera);
(window as unknown as { __booted: boolean }).__booted = true;
