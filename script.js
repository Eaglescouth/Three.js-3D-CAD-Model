import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
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

// 1. Ambient Light (Soft white light everywhere)
const ambientLight = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambientLight);

// 2. Directional Light (The "Sun" - creates depth/shadows)
const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
directionalLight.position.set(1, 1, 1);
scene.add(directionalLight);

const renderer = new THREE.WebGLRenderer({ alpha: true }); // Transparent!
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- OBJECT SETUP ---
// 1. Create a "Placeholder" Cube (so the app doesn't crash while loading)
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 }); // "Standard" reacts to light
let cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// 2. The "Pointer" Variable
// We will control THIS variable in the loop.
// Initially, it controls the cube.
let activeObject = cube;

// Dragging State
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// --- UPLOAD LOGIC ---
const fileInput = document.getElementById("file-input");
const loader = new GLTFLoader();

// 1. Listen for file uploads
fileInput.addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) return;

  // 2. Create a temporary URL for the file
  const url = URL.createObjectURL(file);

  // 3. Load the model from that URL
  loadModel(url);
});

// Helper function to load a model
function loadModel(url) {
  loader.load(
    url,
    function (gltf) {
      const model = gltf.scene;

      // Auto-Scaling:
      // Different models have wildly different sizes.
      // We force them to a standard size (Box of 2x2x2)
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const scaleFactor = 2 / Math.max(size.x, size.y, size.z);
      model.scale.set(scaleFactor, scaleFactor, scaleFactor);

      // Cleanup: Remove the old object
      if (activeObject) {
        scene.remove(activeObject);
      }

      // Add new object
      scene.add(model);
      activeObject = model;

      console.log("📦 New Model Loaded!");
    },
    undefined,
    function (error) {
      console.error(error);
      alert("Error loading model. Make sure it is a valid .glb file.");
    }
  );
}

// 4. Load a default model on startup (The Buggy)
loadModel(
  "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Buggy/glTF-Binary/Buggy.glb"
);

// --- MEDIAPIPE SETUP (New Code) ---
let handLandmarker = undefined;
let lastVideoTime = -1;

// --- SCALING & ROTATION STATE ---
let initialPinchDistance = null;
let initialScale = null;
let initialAngle = null;
let initialRotation = null;

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

// --- COORDINATE MAPPING HELPER ---
function getWorldSizeAtDistance(distance) {
  const vFOV = THREE.MathUtils.degToRad(camera.fov); // Convert 75 deg to radians
  const height = 2 * Math.tan(vFOV / 2) * distance;
  const width = height * camera.aspect;
  return { width, height };
}

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
    if (results.landmarks.length === 2) {
      // === MODE 1: SCALE & ROTATE (Two Hands) ===
      const hand1 = results.landmarks[0];
      const hand2 = results.landmarks[1];

      const pinch1 = getDistance(hand1[8], hand1[4]) < 0.1;
      const pinch2 = getDistance(hand2[8], hand2[4]) < 0.1;

      if (pinch1 && pinch2) {
        // 1. Get Coordinates of both Index Fingers
        const p1 = hand1[8];
        const p2 = hand2[8];

        // 2. Calculate Distance (For SCALING)
        const currentDistance = getDistance(p1, p2);

        // 3. Calculate Angle (For ROTATION)
        const currentAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

        // Record initial state when starting to pinch
        if (initialPinchDistance === null) {
          initialPinchDistance = currentDistance;
          initialScale = activeObject.scale.x;
          initialAngle = currentAngle;
          initialRotation = activeObject.rotation.y;
        }

        // Calculate relative scale change
        const scaleRatio = currentDistance / initialPinchDistance;
        const newScale = initialScale * scaleRatio;
        const clampedScale = Math.max(0.005, Math.min(newScale, 2));
        activeObject.scale.set(clampedScale, clampedScale, clampedScale);

        // Calculate relative rotation change
        const angleDelta = currentAngle - initialAngle;
        activeObject.rotation.y = initialRotation - angleDelta; // Negative to match natural hand direction

        // Visual Feedback: Gold
        if (activeObject === cube) activeObject.material.color.setHex(0xffd700);
      } else {
        // Reset scaling and rotation state when not pinching both
        initialPinchDistance = null;
        initialScale = null;
        initialAngle = null;
        initialRotation = null;

        if (activeObject === cube) activeObject.material.color.setHex(0xaaaaaa);
      }

      // Reset dragging state if we switch to 2 hands
      isDragging = false;
    } else if (results.landmarks.length === 1) {
      // === MODE 2: MOVING (One Hand) ===
      const landmarks = results.landmarks[0];
      const indexTip = landmarks[8];
      const thumbTip = landmarks[4];

      // 1. Calculate Finger Position in 3D World (Raw)
      const worldSize = getWorldSizeAtDistance(5);
      const fingerX = (0.5 - indexTip.x) * worldSize.width;
      const fingerY = (0.5 - indexTip.y) * worldSize.height;

      const distance = getDistance(indexTip, thumbTip);
      const isPinching = distance < 0.1;

      if (isPinching) {
        if (!isDragging) {
          // --- GRAB START (First Frame) ---
          isDragging = true;

          // Calculate the "Handle" (Offset)
          // Offset = ObjectPos - FingerPos
          dragOffset.x = activeObject.position.x - fingerX;
          dragOffset.y = activeObject.position.y - fingerY;
        }

        // --- DRAGGING (Every Frame) ---
        // Target = FingerPos + Offset
        const targetX = fingerX + dragOffset.x;
        const targetY = fingerY + dragOffset.y;

        // Smoothly move object to the target
        activeObject.position.x += (targetX - activeObject.position.x) * 0.2;
        activeObject.position.y += (targetY - activeObject.position.y) * 0.2;

        // Visual: Blue
        if (activeObject === cube) activeObject.material.color.setHex(0x0000ff);
      } else {
        // --- RELEASED ---
        isDragging = false;

        // Visual: Green
        if (activeObject === cube) activeObject.material.color.setHex(0x00ff00);
      }
    }
  }

  // 3. Render 3D Scene
  renderer.render(scene, camera);

  // Loop
  window.requestAnimationFrame(predictWebcam);
}

// --- PINCH HELPER ---
function getDistance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}
