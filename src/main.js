import * as THREE from "three";

// ---------- 基本セット ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf2f2f2);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(2.2, 1.8, 2.6);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);

// ライト
const ambient = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambient);

const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(3, 4, 2);
scene.add(dir);

// ---------- キューブ（1面だけ赤） ----------
const geometry = new THREE.BoxGeometry(1, 1, 1);

// BoxGeometry の面（6面）にそれぞれ別マテリアルを割り当て
// 順番は: +X, -X, +Y, -Y, +Z, -Z（※Three.jsのBoxGeometryのgroupsに従う）
const blue = new THREE.MeshStandardMaterial({ color: 0x1e66ff });
const red = new THREE.MeshStandardMaterial({ color: 0xff2b2b });

// 例：+Z面だけ赤にする（5番目が +Z のことが多い/環境差は少ないが後述で説明）
const materials = [blue, blue, blue, blue, red, blue];

const cube = new THREE.Mesh(geometry, materials);
cube.rotation.set(0.3, 0.4, 0);
scene.add(cube);

// ---------- ドラッグ回転 ----------
let isDragging = false;
let lastX = 0;
let lastY = 0;

const canvas = renderer.domElement;

canvas.addEventListener("pointerdown", (e) => {
  isDragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!isDragging) return;

  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;

  // 直感的な回転量（好みで調整）
  const rotSpeed = 0.01;
  cube.rotation.y += dx * rotSpeed;
  cube.rotation.x += dy * rotSpeed;
});

canvas.addEventListener("pointerup", () => {
  isDragging = false;
});

// ---------- クリックで「赤い面」判定 ----------
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

let cleared = false;

function showClearOverlay() {
  const el = document.createElement("div");
  el.textContent = "CLEAR!";
  el.style.position = "fixed";
  el.style.left = "50%";
  el.style.top = "50%";
  el.style.transform = "translate(-50%, -50%)";
  el.style.padding = "18px 28px";
  el.style.borderRadius = "16px";
  el.style.background = "rgba(0,0,0,0.75)";
  el.style.color = "white";
  el.style.fontSize = "32px";
  el.style.fontFamily = "system-ui, -apple-system, sans-serif";
  el.style.letterSpacing = "0.06em";
  document.body.appendChild(el);
}

canvas.addEventListener("click", (e) => {
  if (cleared) return;
  // ドラッグ直後のclick誤爆を減らしたい場合は、ドラッグ距離の閾値を入れると良い

  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  mouseNDC.set(x, y);

  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObject(cube, false);

  if (hits.length === 0) return;

  // faceIndex から「どの面（materialIndex）」かを判定
  const hit = hits[0];
  const faceIndex = hit.faceIndex; // 三角形のインデックス（1面=2三角形）

  // BoxGeometryのgroupsは 6面×2三角形×3頂点 のまとまりになっている
  // faceIndex(三角形) → 面番号(0..5) は概ね floor(faceIndex / 2)
  const side = Math.floor(faceIndex / 2);

  // どの面を赤にしたか（materialsのどれがredか）に合わせる
  // 今回は +Z 面にしたいので、まずは side===4 を「当たり」にしている
  // もし当たり面がズレる場合は、下のconsole.logを見て side を調整してください
  // console.log("hit side:", side);

  const redSide = 4; // <- ここを調整（0..5）
  if (side === redSide) {
    cleared = true;
    showClearOverlay();
  }
});

// ---------- リサイズ ----------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- ループ ----------
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();
