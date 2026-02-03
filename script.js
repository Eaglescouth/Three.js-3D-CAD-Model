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

// 3. Load the 3D Model (The Car)
const loader = new GLTFLoader();
loader.load(
  "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Buggy/glTF-Binary/Buggy.glb", // A free buggy car model
  function (gltf) {
    // This code runs ONLY when the download finishes:
    const model = gltf.scene;

    // Fix Scale (Models are often huge or tiny)
    model.scale.set(0.01, 0.01, 0.01);

    // Swap the actors
    scene.remove(cube); // Delete the cube
    scene.add(model); // Add the car
    activeObject = model; // Update the pointer!

    console.log("🏎️ Car Loaded!");
  },
  undefined,
  function (error) {
    console.error(error);
  }
);

// --- MEDIAPIPE SETUP (New Code) ---
let handLandmarker = undefined;
let lastVideoTime = -1;

// --- SCALING STATE ---
let initialPinchDistance = null;
let initialScale = null;

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
      // === MODE 1: RESIZING (Two Hands) ===
      const hand1 = results.landmarks[0];
      const hand2 = results.landmarks[1];

      // 1. Check Pinches
      const pinch1 = getDistance(hand1[8], hand1[4]) < 0.1;
      const pinch2 = getDistance(hand2[8], hand2[4]) < 0.1;

      if (pinch1 && pinch2) {
        // 2. Calculate Distance between both Index Fingers
        const pinchDistance = getDistance(hand1[8], hand2[8]);

        // 3. Record initial state when starting to pinch
        if (initialPinchDistance === null) {
          initialPinchDistance = pinchDistance;
          initialScale = activeObject.scale.x; // Capture current scale
        }

        // 4. Calculate relative scale change
        const scaleRatio = pinchDistance / initialPinchDistance;
        const newScale = initialScale * scaleRatio;

        // 5. Update Object Size (with min/max limits)
        const clampedScale = Math.max(0.005, Math.min(newScale, 2));
        activeObject.scale.set(clampedScale, clampedScale, clampedScale);

        // Visual Feedback: Gold = Resizing (only for cube)
        if (activeObject === cube) {
          cube.material.color.setHex(0xffd700);
        }
      } else {
        // Reset scaling state when not pinching both
        initialPinchDistance = null;
        initialScale = null;

        // Hands visible but not pinching both
        if (activeObject === cube) {
          cube.material.color.setHex(0xaaaaaa); // Grey (Waiting)
        }
      }
    } else if (results.landmarks.length === 1) {
      // === MODE 2: MOVING (One Hand) ===
      const landmarks = results.landmarks[0];
      const indexTip = landmarks[8];
      const thumbTip = landmarks[4];

      const distance = getDistance(indexTip, thumbTip);
      const isPinching = distance < 0.1;

      if (isPinching) {
        // Drag Logic
        const worldSize = getWorldSizeAtDistance(5);
        const x = (0.5 - indexTip.x) * worldSize.width;
        const y = (0.5 - indexTip.y) * worldSize.height;

        activeObject.position.x += (x - activeObject.position.x) * 0.2;
        activeObject.position.y += (y - activeObject.position.y) * 0.2;

        // Visual Feedback: Blue = Dragging (only for cube)
        if (activeObject === cube) {
          cube.material.color.setHex(0x0000ff);
        }
      } else {
        // Not pinching = Idle (only for cube)
        if (activeObject === cube) {
          cube.material.color.setHex(0x00ff00); // Green
        }
      }
    }
  }

  // 3. Render 3D Scene
  activeObject.rotation.x += 0.01;
  activeObject.rotation.y += 0.01;
  renderer.render(scene, camera);

  // Loop
  window.requestAnimationFrame(predictWebcam);
}

// --- PINCH HELPER ---
function getDistance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}
