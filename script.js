import * as THREE from "three";
// 1. Import MediaPipe
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// --- 3D SETUP (Existing Code) ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({ alpha: true }); // Transparent!
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Create the Cube
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// --- MEDIAPIPE SETUP (New Code) ---
let handLandmarker = undefined;
let lastVideoTime = -1;

async function createHandLandmarker() {
  // Download the WASM files
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  // Load the Hand Model
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });
  console.log("✅ HandLandmarker is loaded!");
}
// Start the loading process
createHandLandmarker();

// --- WEBCAM & RENDER LOOP ---
const video = document.getElementById("webcam");

// Webcam Access
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
    video.srcObject = stream;
    video.addEventListener("loadeddata", predictWebcam);
  });
}

async function predictWebcam() {
  // 1. Resize canvas if window changes
  if (video.videoWidth !== renderer.domElement.width) {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  // 2. Detect Hands (Only if model is loaded)
  if (handLandmarker && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const results = handLandmarker.detectForVideo(video, Date.now());

    // --- LOGIC GOES HERE ---
    if (results.landmarks.length > 0) {
      // If we see a hand, turn the cube RED
      cube.material.color.setHex(0xff0000);

      // Log the coordinates of the Index Finger (Tip is index 8)
      const indexTip = results.landmarks[0][8];
      console.log("Finger:", indexTip.x, indexTip.y);
    } else {
      // No hand? Green.
      cube.material.color.setHex(0x00ff00);
    }
  }

  // 3. Render 3D Scene
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);

  // Loop
  window.requestAnimationFrame(predictWebcam);
}
